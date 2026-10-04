import {
  E18,
  parseDecimal,
  sharesFromTokens,
  gradeFromScore,
  type Issuer,
  type Integrity,
  type CheckRecord,
} from "@tally/core";

export type { Integrity } from "@tally/core";

export const STABLECOINS: Readonly<Record<string, { symbol: string; decimals: number }>> = {
  "0x55d398326f99059ff775485246999027b3197955": { symbol: "USDT", decimals: 18 },
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": { symbol: "USDC", decimals: 18 },
  "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d": { symbol: "USD1", decimals: 18 },
  "0x1f8955e640cbd9abc3c3bb408c9e2e1f5f20dfe6": { symbol: "USDon", decimals: 18 },
};
export const BOT_TURNOVER_MULTIPLE = 50n;
export const BOT_TURNOVER_USD = 50_000n * E18;
export const CUSTODY_PERCENT = 20n * E18;
export const WHALE_USD = 10_000n * E18;
export const FLOW_MAX_AGE_MS = 15 * 60_000;
export const RADAR_MAX_AGE_MS = 60 * 60_000;
export const INACTIVE_FACTS_REFRESH_MS = 30 * 60_000;
export const ACTIVE_FLOW_LIMIT = 60;
export const RAW_FLOW_MIN_USD = 1000n * E18;
export const WINDOWS = { "1h": 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000 } as const;
export type FlowWindow = keyof typeof WINDOWS;
export const CHAIN_PRICE_REASON = "price unavailable from chain logs";
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO = "0x" + "0".repeat(40);
export interface FlowToken {
  ticker: string;
  issuer: Issuer;
  address: string;
  symbol: string;
  multiplier: bigint;
}

export interface FlowCandidate {
  token: FlowToken;
  rawVolume24hUsd: bigint | null;
  held: boolean;
}
/** Held assets take priority inside the hard cap; missing multipliers never become shares. */
export function selectActiveFlow(candidates: readonly FlowCandidate[]) {
  const eligible = candidates.filter(
    (c) =>
      c.token.multiplier > 0n &&
      (c.held || (c.rawVolume24hUsd !== null && c.rawVolume24hUsd >= RAW_FLOW_MIN_USD)),
  );
  if (eligible.filter((c) => c.held).length > ACTIVE_FLOW_LIMIT)
    throw new RangeError(
      "Registered wallets hold more than 60 resolved tokens; active-set capacity exceeded",
    );
  const ranked = [...eligible].sort((a, b) => {
    if (a.held !== b.held) return a.held ? -1 : 1;
    const left = a.rawVolume24hUsd ?? 0n,
      right = b.rawVolume24hUsd ?? 0n;
    return (
      (left > right ? -1 : left < right ? 1 : 0) || a.token.address.localeCompare(b.token.address)
    );
  });
  const active = ranked.slice(0, ACTIVE_FLOW_LIMIT).map((c) => c.token);
  const addresses = new Set(active.map((t) => t.address.toLowerCase()));
  const statuses = Object.fromEntries(
    candidates.map((c) => {
      const selected = addresses.has(c.token.address.toLowerCase());
      const reason = selected
        ? null
        : c.token.multiplier <= 0n
          ? "share multiplier unavailable"
          : c.rawVolume24hUsd === null
            ? "raw 24h volume unavailable"
            : c.rawVolume24hUsd < RAW_FLOW_MIN_USD
              ? "no real market: under $1,000 24h"
              : "flow inactive: outside top 60 by raw 24h volume";
      return [c.token.address.toLowerCase(), { active: selected, held: c.held, reason }];
    }),
  );
  return { active, statuses };
}
export interface TradeInput {
  txHash: string;
  userAddress: string;
  type: "buy" | "sell";
  time: number;
  changedTokenInfo: readonly { amount: string; tokenContractAddress: string }[];
}
export interface HolderInput {
  holderWalletAddress: string;
  holdAmount: string;
  holdingPercent: string | null;
  boughtAmount: string;
  soldAmount: string;
  avgBuyPrice?: string | null;
  avgSellPrice?: string | null;
  fundingSourceLabel?: { tagName: string } | null;
}
export interface PoolInput {
  poolAddress: string;
  liquidityAmount: readonly { tokenContractAddress: string }[];
}
export interface ChainLog {
  address: string;
  topics: readonly string[];
  data: string;
  transactionHash: string;
  blockNumber: bigint;
  logIndex: number;
  timestampMs: number;
  removed?: boolean;
}
export interface ReceiptInput {
  transactionHash: string;
  status: "success" | "reverted";
  logs: readonly Pick<ChainLog, "address" | "topics" | "data" | "logIndex">[];
}
export interface FlowTrade {
  id: string;
  txHash: string;
  wallet: string;
  pool?: string;
  side: "buy" | "sell";
  at: number;
  shares: bigint;
  usd: bigint | null;
  pricePerShare: bigint | null;
  priceReason: string | null;
  source: "binance" | "chain-logs";
}
export type Classification = { trade: FlowTrade; reason: null } | { trade: null; reason: string };
export interface WalletLabels {
  bot: boolean;
  custody: boolean;
  reasons: string[];
}
export interface LabelLists {
  bots?: readonly string[];
  custody?: readonly string[];
  routers?: readonly string[];
}

/** Exact exponent expansion, including scientific notation used by the API. */
export function fixed(value: string, decimals = 18): bigint {
  const match = /^(-?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value.trim());
  if (!match) throw new Error("Invalid decimal fact");
  const [, sign, whole, fraction = "", exponent = "0"] = match;
  const exp = Number(exponent);
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 1000)
    throw new Error("Invalid decimal exponent");
  const digits = whole! + fraction;
  const point = whole!.length + exp;
  const plain =
    point <= 0
      ? "0." + "0".repeat(-point) + digits
      : point >= digits.length
        ? digits + "0".repeat(point - digits.length)
        : digits.slice(0, point) + "." + digits.slice(point);
  return parseDecimal(sign + plain, decimals);
}
const listed = (addresses: readonly string[] | undefined, address: string) =>
  addresses?.some((a) => a.toLowerCase() === address.toLowerCase()) ?? false;
const abs = (n: bigint) => (n < 0n ? -n : n);

export function classifyTrade(input: TradeInput, token: FlowToken): Classification {
  if (token.multiplier <= 0n)
    return { trade: null, reason: "Share multiplier unavailable or invalid" };
  if (!Number.isFinite(input.time)) return { trade: null, reason: "Trade time unavailable" };
  const stock = input.changedTokenInfo.filter(
    (leg) => leg.tokenContractAddress.toLowerCase() === token.address.toLowerCase(),
  );
  const counterpart = input.changedTokenInfo.filter(
    (leg) => leg.tokenContractAddress.toLowerCase() !== token.address.toLowerCase(),
  );
  if (
    stock.length !== 1 ||
    counterpart.length !== 1 ||
    !STABLECOINS[counterpart[0]!.tokenContractAddress.toLowerCase()]
  )
    return { trade: null, reason: "Counterpart is not one unambiguous dollar stablecoin" };
  const shares = sharesFromTokens(abs(fixed(stock[0]!.amount)), token.multiplier);
  const usd = abs(fixed(counterpart[0]!.amount));
  if (shares <= 0n || usd <= 0n)
    return { trade: null, reason: "Trade amounts are zero or below precision" };
  return {
    reason: null,
    trade: {
      id: [
        input.txHash,
        input.userAddress.toLowerCase(),
        input.type,
        stock[0]!.amount,
        counterpart[0]!.amount,
      ].join(":"),
      txHash: input.txHash,
      wallet: input.userAddress.toLowerCase(),
      side: input.type,
      at: input.time,
      shares,
      usd,
      pricePerShare: (usd * E18) / shares,
      priceReason: null,
      source: "binance",
    },
  };
}

export function labelWallet(holder: HolderInput, lists: LabelLists = {}): WalletLabels {
  const reasons: string[] = [];
  const bought = fixed(holder.boughtAmount),
    sold = fixed(holder.soldAmount);
  const turnoverTokens = bought + sold;
  const turnoverUsd =
    (holder.avgBuyPrice == null ? 0n : (bought * fixed(holder.avgBuyPrice)) / E18) +
    (holder.avgSellPrice == null ? 0n : (sold * fixed(holder.avgSellPrice)) / E18);
  const bot =
    listed(lists.bots, holder.holderWalletAddress) ||
    (turnoverTokens > 0n &&
      turnoverTokens >= BOT_TURNOVER_MULTIPLE * fixed(holder.holdAmount) &&
      turnoverUsd >= BOT_TURNOVER_USD);
  const custody =
    listed(lists.custody, holder.holderWalletAddress) ||
    (holder.holdingPercent !== null &&
      fixed(holder.holdingPercent) >= CUSTODY_PERCENT &&
      holder.fundingSourceLabel?.tagName === "CEX Wallet");
  if (bot) reasons.push("High turnover relative to current holding, or configured bot list");
  if (custody)
    reasons.push("CEX-funded holder with at least 20% of supply, or configured custody list");
  if ((bought > 0n && holder.avgBuyPrice == null) || (sold > 0n && holder.avgSellPrice == null))
    reasons.push("Bot turnover price unavailable");
  if (holder.holdingPercent === null)
    reasons.push("Holder supply percentage unavailable; custody percentage rule skipped");
  return { bot, custody, reasons };
}

export function dollarPools(pools: readonly PoolInput[], token: FlowToken): string[] {
  return pools
    .filter(
      (p) =>
        /^0x[0-9a-fA-F]{40}$/.test(p.poolAddress) &&
        p.liquidityAmount.length === 2 &&
        p.liquidityAmount.some(
          (l) => l.tokenContractAddress.toLowerCase() === token.address.toLowerCase(),
        ) &&
        p.liquidityAmount.some((l) => STABLECOINS[l.tokenContractAddress.toLowerCase()]),
    )
    .map((p) => p.poolAddress.toLowerCase());
}
export function transferEndpoints(
  log: Pick<ChainLog, "topics" | "data">,
): { from: string; to: string; amount: bigint } | null {
  if (
    log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC ||
    log.topics.length !== 3 ||
    !log.topics.slice(1).every((t) => /^0x[0-9a-fA-F]{64}$/.test(t)) ||
    !/^0x[0-9a-fA-F]{64}$/.test(log.data)
  )
    return null;
  return {
    from: "0x" + log.topics[1]!.slice(-40).toLowerCase(),
    to: "0x" + log.topics[2]!.slice(-40).toLowerCase(),
    amount: BigInt(log.data),
  };
}
export function classifyChainLogs(
  logs: readonly ChainLog[],
  token: FlowToken,
  pools: readonly PoolInput[],
  lists: LabelLists = {},
): { trades: FlowTrade[]; notes: string[] } {
  const known = new Set(pools.map((p) => p.poolAddress.toLowerCase()));
  const dollars = new Set(dollarPools(pools, token));
  const trades: FlowTrade[] = [];
  const notes = new Set<string>([CHAIN_PRICE_REASON]);
  const txEndpoints = new Map<string, { from: Set<string>; to: Set<string> }>();
  for (const log of logs) {
    if (log.removed || log.address.toLowerCase() !== token.address.toLowerCase()) continue;
    const e = transferEndpoints(log);
    if (!e) continue;
    const tx = txEndpoints.get(log.transactionHash) ?? {
      from: new Set<string>(),
      to: new Set<string>(),
    };
    tx.from.add(e.from);
    tx.to.add(e.to);
    txEndpoints.set(log.transactionHash, tx);
  }
  if (!known.size) notes.add("Known pools unavailable; Transfers cannot be classified");
  if (pools.some((p) => p.poolAddress.length !== 42))
    notes.add("V4 pool IDs cannot be matched to Transfer endpoints");
  for (const log of logs) {
    if (log.removed || log.address.toLowerCase() !== token.address.toLowerCase()) continue;
    const endpoints = transferEndpoints(log);
    if (!endpoints || token.multiplier <= 0n) {
      notes.add("Invalid Transfer or missing multiplier");
      continue;
    }
    const { from, to, amount } = endpoints;
    if (from === ZERO || to === ZERO || amount === 0n || known.has(from) === known.has(to))
      continue;
    const side = known.has(from) ? "buy" : "sell";
    const pool = side === "buy" ? from : to;
    const wallet = side === "buy" ? to : from;
    if (!dollars.has(pool) || listed(lists.routers, wallet)) continue;
    // An intermediate address both receives and sends this stock within the tx: router hop.
    const tx = txEndpoints.get(log.transactionHash)!;
    const hop = tx.from.has(wallet) && tx.to.has(wallet);
    if (hop) continue;
    const shares = sharesFromTokens(amount, token.multiplier);
    if (shares === 0n) continue;
    trades.push({
      id: `${log.transactionHash}:${log.logIndex}`,
      txHash: log.transactionHash,
      wallet,
      pool,
      side,
      at: log.timestampMs,
      shares,
      usd: null,
      pricePerShare: null,
      priceReason: CHAIN_PRICE_REASON,
      source: "chain-logs",
    });
  }
  return { trades, notes: [...notes] };
}

/** Receipt evidence must cross the SAME pool in the opposite direction.
 * Multiple stock prints touching that pool make allocation ambiguous.
 */
export function priceWhaleFromReceipt(
  trade: FlowTrade,
  receipt: ReceiptInput,
  token: FlowToken,
): FlowTrade {
  if (
    !trade.pool ||
    receipt.status !== "success" ||
    receipt.transactionHash.toLowerCase() !== trade.txHash.toLowerCase()
  )
    return trade;
  const stock = receipt.logs
    .filter((l) => l.address.toLowerCase() === token.address.toLowerCase())
    .map(transferEndpoints)
    .filter((e) => e && (e.from === trade.pool || e.to === trade.pool));
  if (stock.length !== 1) return trade;
  const stockTransfer = stock[0]!;
  if (
    (trade.side === "buy"
      ? stockTransfer.from !== trade.pool || stockTransfer.to !== trade.wallet
      : stockTransfer.to !== trade.pool || stockTransfer.from !== trade.wallet) ||
    sharesFromTokens(stockTransfer.amount, token.multiplier) !== trade.shares
  )
    return trade;
  const stable = receipt.logs
    .filter((l) => STABLECOINS[l.address.toLowerCase()])
    .flatMap((l) => {
      const e = transferEndpoints(l);
      if (!e || (trade.side === "buy" ? e.to !== trade.pool : e.from !== trade.pool)) return [];
      return [{ address: l.address.toLowerCase(), amount: e.amount }];
    });
  if (!stable.length || new Set(stable.map((l) => l.address)).size !== 1) return trade;
  const decimals = STABLECOINS[stable[0]!.address]!.decimals;
  const usd = (stable.reduce((sum, l) => sum + l.amount, 0n) * E18) / 10n ** BigInt(decimals);
  if (usd <= 0n) return trade;
  return { ...trade, usd, pricePerShare: (usd * E18) / trade.shares, priceReason: null };
}

export interface FlowSnapshot {
  token: FlowToken;
  trades: FlowTrade[];
  labels: Record<string, WalletLabels>;
  holders: HolderInput[] | null;
  holdersReason: string | null;
  coverageStartMs: number | null;
  cleaningReason?: string | null;
  notes: string[];
}
export interface WindowAggregate {
  netShares: bigint;
  buyShares: bigint;
  sellShares: bigint;
  buys: number;
  sells: number;
  realVolumeUsd: bigint | null;
  reason: string | null;
}
export interface FlowAggregate {
  ticker: string;
  issuer: Issuer;
  address: string;
  windows: Record<FlowWindow, WindowAggregate>;
  lastRealTradeAt: number | null;
  lastRealTradeAgeMs: number | null;
  lastRealTradeReason: string | null;
  top10ConcentrationPercent: bigint | null;
  concentrationReason: string | null;
  whalePrints: FlowTrade[];
  notes: string[];
}
export function aggregateFlow(snapshot: FlowSnapshot, now: number): FlowAggregate {
  const real = [...new Map(snapshot.trades.map((t) => [t.id, t])).values()].filter(
    (t) => t.at <= now && !snapshot.labels[t.wallet]?.bot,
  );
  const windows = Object.fromEntries(
    Object.entries(WINDOWS).map(([window, ms]) => {
      const trades = real.filter((t) => t.at >= now - ms);
      const buy = trades.filter((t) => t.side === "buy"),
        sell = trades.filter((t) => t.side === "sell");
      const buyShares = buy.reduce((s, t) => s + t.shares, 0n),
        sellShares = sell.reduce((s, t) => s + t.shares, 0n);
      const complete = snapshot.coverageStartMs !== null && snapshot.coverageStartMs <= now - ms;
      const priced = trades.every((t) => t.usd !== null);
      const reason =
        snapshot.cleaningReason ??
        (!complete
          ? "Trade history does not cover this window"
          : !priced
            ? CHAIN_PRICE_REASON
            : null);
      return [
        window,
        {
          netShares: buyShares - sellShares,
          buyShares,
          sellShares,
          buys: buy.length,
          sells: sell.length,
          realVolumeUsd: reason ? null : trades.reduce((s, t) => s + t.usd!, 0n),
          reason,
        },
      ];
    }),
  ) as Record<FlowWindow, WindowAggregate>;
  const lastRealTradeAt = real.reduce<number | null>(
    (last, t) => (last === null || t.at > last ? t.at : last),
    null,
  );
  const percentMissing = snapshot.holders?.some((h) => h.holdingPercent === null) ?? false;
  const percentages = percentMissing
    ? null
    : snapshot.holders
        ?.filter((h) => !snapshot.labels[h.holderWalletAddress.toLowerCase()]?.custody)
        // The complete-holder guard above excludes nulls before conversion or sorting.
        .map((h) => fixed(h.holdingPercent!))
        .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
        .slice(0, 10);
  return {
    ticker: snapshot.token.ticker,
    issuer: snapshot.token.issuer,
    address: snapshot.token.address,
    windows,
    lastRealTradeAt,
    lastRealTradeAgeMs: lastRealTradeAt === null ? null : Math.max(0, now - lastRealTradeAt),
    lastRealTradeReason: lastRealTradeAt === null ? "No real trade in available history" : null,
    top10ConcentrationPercent: percentages
      ? percentages.reduce((s, percent) => s + percent, 0n)
      : null,
    concentrationReason: percentMissing
      ? ["Holder supply percentage unavailable; concentration unknown", snapshot.holdersReason]
          .filter(Boolean)
          .join("; ")
      : (snapshot.holdersReason ?? (percentages ? null : "Holders unavailable")),
    whalePrints: real
      .filter((t) => t.usd !== null && t.usd >= WHALE_USD)
      .sort((a, b) => b.at - a.at),
    notes: snapshot.notes,
  };
}

export interface GhostInput {
  realVolume24hUsd: bigint | null;
  lastRealTradeAgeMs: number | null;
  reason: string | null;
  stale?: boolean;
}
export interface GhostCheck {
  id: "cleaned-flow";
  outcome: "pass" | "deduct" | "skipped";
  points: number;
  ghost: boolean | null;
  reason: string;
  inputs: GhostInput;
}
export function ghostInput(flow: FlowAggregate, stale = false): GhostInput {
  return {
    realVolume24hUsd: flow.windows["24h"].realVolumeUsd,
    lastRealTradeAgeMs: flow.lastRealTradeAgeMs,
    reason: flow.windows["24h"].reason ?? flow.lastRealTradeReason,
    stale,
  };
}
/** Inject this port into core's grade; default N=3 days is configurable. No core edits. */
export function checkGhost(input: GhostInput, maxNoTradeDays = 3): GhostCheck {
  if (!Number.isFinite(maxNoTradeDays) || maxNoTradeDays <= 0)
    throw new RangeError("Ghost age threshold must be positive");
  if (input.stale || input.realVolume24hUsd === null)
    return {
      id: "cleaned-flow",
      outcome: "skipped",
      points: 0,
      ghost: null,
      reason: input.stale
        ? "Flow snapshot is stale"
        : (input.reason ?? "Cleaned volume unavailable"),
      inputs: input,
    };
  const ghost =
    input.realVolume24hUsd < 1000n * E18 ||
    (input.lastRealTradeAgeMs !== null &&
      input.lastRealTradeAgeMs > maxNoTradeDays * WINDOWS["24h"]);
  return {
    id: "cleaned-flow",
    outcome: ghost ? "deduct" : "pass",
    points: ghost ? 40 : 0,
    ghost,
    reason: ghost
      ? "Under $1,000 of cleaned 24h volume or no real trade within the configured age limit"
      : "Cleaned flow is active",
    inputs: input,
  };
}
/** Pure implementation for the orchestrator's injected core grade port.
 * Replace the raw-volume record while retaining all unrelated checks and deductions.
 */
export function extendIntegrity(
  base: Integrity,
  input: GhostInput,
): Integrity & { flowCheck: GhostCheck } {
  const flowCheck = checkGhost(input);
  if (flowCheck.outcome === "skipped") return { ...base, flowCheck };
  const replacement: CheckRecord = {
    id: "onchain-volume",
    outcome: flowCheck.outcome,
    points: flowCheck.points,
    inputs: {
      basis: "cleaned-flow",
      realVolume24hUsd: input.realVolume24hUsd?.toString(),
      lastRealTradeAgeMs: input.lastRealTradeAgeMs,
    },
    summary: flowCheck.reason,
    flag: flowCheck.ghost ? "ghost" : undefined,
    reason: flowCheck.ghost ? flowCheck.reason : undefined,
  };
  const checks = [...base.checks.filter((c) => c.id !== "onchain-volume"), replacement];
  const score = Math.max(0, 100 - checks.reduce((sum, c) => sum + c.points, 0));
  return {
    ...base,
    score,
    grade: gradeFromScore(score),
    checks,
    flags: [...new Set(checks.flatMap((c) => (c.flag ? [c.flag] : [])))],
    reasons: checks.filter((c) => c.reason),
    flowCheck,
  };
}
