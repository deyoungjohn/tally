import { E18, mulDiv } from "@tally/core";
import type { Alert, Decision, DecisionRow, Policy, PolicySettings, State } from "./types";

export const PER_TRADE_CEILING = 100n * E18;
export const DAILY_CEILING = 250n * E18;
export const DEFAULT_PER_TRADE_CAP = 25n * E18;
export const DEFAULT_DAILY_CAP = 50n * E18;
export const MIN_SELL_USD = 6n * E18;
export const ALERT_MAX_AGE_MS = 60_000;
export const POSITION_MAX_AGE_MS = 60_000;
const DAY_MS = 86_400_000;
const min = (...values: bigint[]) => values.reduce((a, b) => (a < b ? a : b));

export function effectiveCaps(policy: Pick<PolicySettings, "perTradeCap" | "dailyCap">) {
  return {
    perTrade: min(policy.perTradeCap ?? DEFAULT_PER_TRADE_CAP, PER_TRADE_CEILING),
    daily: min(policy.dailyCap ?? DEFAULT_DAILY_CAP, DAILY_CEILING),
  };
}

/** Only receipt-backed actual live executions count; shadow proposals spend nothing. */
export function spentToday(rows: readonly DecisionRow[], wallet: string, now: number): bigint {
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  let spent = 0n;
  for (const row of rows) {
    if (row.walletAddress.toLowerCase() !== wallet.toLowerCase() || row.mode !== "live") continue;
    if (row.executedUsd === undefined && row.executedAt === undefined && !row.receiptId) continue;
    if (
      row.decision !== "execute" ||
      !row.receiptId ||
      typeof row.executedUsd !== "bigint" ||
      row.executedUsd < 0n ||
      row.executedAt === undefined ||
      !Number.isFinite(row.executedAt) ||
      row.executedAt > now
    )
      throw new Error("Invalid executed decision evidence");
    if (row.executedAt >= dayStart) spent += row.executedUsd;
  }
  return spent;
}

/** Pure decision rail. 'execute' is permission to propose a USDT sale, never an execution. */
export function decide(alert: Alert, policy: Policy, state: State, now: number): Decision {
  const reasons: string[] = [];
  if (policy.killSwitch) reasons.push("kill switch on");
  if (state.rows.some((row) => row.alertId === alert.id)) reasons.push("alert already decided");
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(alert.createdAt) ||
    alert.createdAt > now ||
    now - alert.createdAt > ALERT_MAX_AGE_MS ||
    !Number.isFinite(alert.evidence.observedAt) ||
    alert.evidence.observedAt > now ||
    now - alert.evidence.observedAt > ALERT_MAX_AGE_MS
  )
    reasons.push("alert stale");
  if (alert.issuer === "xstocks") reasons.push("issuer not sellable (xStocks have no market)");
  const token = alert.evidence.snapshotKey.toLowerCase();
  if (!policy.tokenAllowList.some((address) => address.toLowerCase() === token))
    reasons.push("token not allowed");

  const p = state.position;
  if (!p || p.multiplier === null || p.multiplier <= 0n) reasons.push("unknown multiplier");
  if (!p || p.shares === null || p.shares < 0n) reasons.push("unknown shares");
  if (
    !p ||
    p.balanceSource !== "chain" ||
    p.chainBalanceTokens === null ||
    p.chainBalanceTokens < 0n
  )
    reasons.push("chain balance unavailable");
  if (p) {
    if (
      p.walletAddress.toLowerCase() !== alert.walletAddress.toLowerCase() ||
      p.tokenAddress.toLowerCase() !== token ||
      p.ticker !== alert.ticker ||
      p.issuer !== alert.issuer
    )
      reasons.push("position does not match alert");
    if (
      !Number.isFinite(p.observedAt) ||
      p.observedAt > now ||
      now - p.observedAt > POSITION_MAX_AGE_MS
    )
      reasons.push("position stale");
    if (!Number.isInteger(p.tokenDecimals) || p.tokenDecimals < 0 || p.tokenDecimals > 36)
      reasons.push("unknown token decimals");
  }
  if (!p || p.usdPerShare === null || p.usdPerShare <= 0n) reasons.push("unknown share price");

  if (alert.rule === "paused" && policy.armedRules.paused) {
    const hours = policy.armedRules.paused.longerThanHours;
    if (!Number.isFinite(hours) || hours < 0) reasons.push("invalid pause threshold");
    else if (!p || p.paused === null || p.pausedSince === null || !Number.isFinite(p.pausedSince))
      reasons.push("pause duration unknown");
    else if (!p.paused || now - p.pausedSince <= hours * 3_600_000)
      reasons.push("rule condition not met");
  } else if (alert.rule === "grade-drop" && policy.armedRules["grade-drop"]) {
    if (!p?.grade) reasons.push("grade unknown");
    else if (
      p.grade !== "F" &&
      (p.grade !== "D" || policy.armedRules["grade-drop"].atOrBelow !== "D")
    )
      reasons.push("rule condition not met");
  } else if (alert.rule === "price-threshold" && policy.armedRules["price-threshold"]) {
    const regular = policy.isRegularSession?.(now);
    if (regular === undefined || regular === null) reasons.push("session unknown");
    else if (!regular) reasons.push("outside the regular session");
    const stop = policy.armedRules["price-threshold"].stopUsdPerShare;
    if (stop <= 0n) reasons.push("invalid stop threshold");
    else if (
      alert.direction !== "min" ||
      (p?.usdPerShare !== null && p?.usdPerShare !== undefined && p.usdPerShare > stop)
    )
      reasons.push("rule condition not met");
  } else reasons.push("rule not armed");

  const caps = effectiveCaps(policy);
  const remaining = caps.daily - spentToday(state.rows, alert.walletAddress, now);
  if (caps.perTrade < MIN_SELL_USD) reasons.push("cap reached (per trade)");
  if (remaining < MIN_SELL_USD) reasons.push("cap reached (per day)");
  if (reasons.length) return { decision: "alertOnly", reasons };

  // Prior refusals establish non-null facts. Floor every conversion so caps cannot be crossed.
  const position = p!;
  const multiplier = position.multiplier!;
  const price = position.usdPerShare!;
  const tokenUnit = 10n ** BigInt(position.tokenDecimals);
  const shares = min(position.shares!, mulDiv(position.chainBalanceTokens!, multiplier, tokenUnit));
  const positionUsd = mulDiv(shares, price, E18);
  if (positionUsd < MIN_SELL_USD)
    return { decision: "alertOnly", reasons: ["position below the 6 USDT minimum"] };
  const usdCap = min(positionUsd, caps.perTrade, remaining);
  const sellShares = mulDiv(usdCap, E18, price);
  const tokens = min(position.chainBalanceTokens!, mulDiv(sellShares, tokenUnit, multiplier));
  const roundedUsd = mulDiv(mulDiv(tokens, multiplier, tokenUnit), price, E18);
  if (tokens <= 0n || roundedUsd < MIN_SELL_USD)
    return { decision: "alertOnly", reasons: ["position below the 6 USDT minimum"] };
  return {
    decision: "execute",
    reasons: [],
    leg: { ticker: alert.ticker, issuer: alert.issuer, tokens, usdCap },
  };
}
