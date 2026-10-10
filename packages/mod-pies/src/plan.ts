import { E18, formatUnits, mulDiv } from "@tally/core";
import { templateAvailability, validateTemplate } from "./templates";
import { allocateExact, valuePie } from "./valuation";
import type { BuyLeg, PieLeg, RebalanceInput, RebalancePlan, SellLeg } from "./types";

const sum = (values: readonly bigint[]) => values.reduce((n, v) => n + v, 0n);
const min = (a: bigint, b: bigint) => (a < b ? a : b);
function bps(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0 || value > 10000)
    throw new RangeError(`${name} must be 0..10000 bps`);
}

export function rebalancePlan(input: RebalanceInput): RebalancePlan {
  const template = validateTemplate(input.template);
  const threshold = input.driftThresholdBps ?? 500;
  const minimum = input.minOrderUsdtE18 ?? 6n * E18;
  const haircut = input.sellHaircutBps ?? 100;
  bps(threshold, "Drift threshold");
  bps(haircut, "Sell haircut");
  if (
    input.walletUsdtE18 < 0n ||
    minimum <= 0n ||
    (input.mode !== "rebalance" && input.mode.invest < 0n)
  )
    throw new RangeError(
      "Wallet/invest amounts must be nonnegative; minimum order must be positive",
    );
  const availability = templateAvailability(template, input.buyable);
  const valuation = valuePie(template, input.holdings, input.prices);
  const invest = input.mode === "rebalance" ? 0n : input.mode.invest;
  const total = valuation.totalValueE18 + invest;
  const targets = allocateExact(
    total,
    template.holdings.map((h) => BigInt(h.targetWeightBps)),
  );
  const plan: RebalancePlan = {
    before: valuation.before,
    target: template.holdings.map((h, i) => ({
      ticker: h.ticker,
      valueE18: targets[i]!,
      weightBps: h.targetWeightBps,
      driftBps: Math.abs(valuation.before[i]!.weightBps - h.targetWeightBps),
    })),
    legs: [],
    deferred: [],
    unavailable: availability.unavailable,
    excluded: valuation.excluded,
    totals: {
      currentValueE18: valuation.totalValueE18,
      targetValueE18: total,
      walletUsdtE18: input.walletUsdtE18,
      sellValueE18: 0n,
      assumedSellProceedsUsdtE18: 0n,
      buyBudgetUsdtE18: 0n,
      buyUsdtE18: 0n,
      unspentUsdtE18: 0n,
      deferredSellValueE18: 0n,
      deferredBuyUsdtE18: 0n,
    },
    notes: [],
    reason: null,
  };
  if (valuation.excluded.length) {
    plan.reason = `cannot value ${[...new Set(valuation.excluded.map((e) => e.ticker))].join(", ")}`;
    plan.notes.push(plan.reason);
    return plan;
  }
  if (!availability.executable) {
    plan.reason = availability.unavailable.length
      ? "Template contains unavailable tickers"
      : "Preview template is not executable";
    plan.notes.push(plan.reason);
    return plan;
  }
  if (total === 0n) {
    plan.reason = "Empty basket; invest funds to build an allocation";
    return plan;
  }
  if (input.mode === "rebalance" && plan.target.every((h) => h.driftBps < threshold)) {
    plan.reason = "within threshold";
    return plan;
  }
  let sequence = 0;
  const add = (leg: Omit<SellLeg, "sequence"> | Omit<BuyLeg, "sequence">) => {
    const numbered: PieLeg = { ...leg, sequence: ++sequence };
    if (leg.valueE18 < minimum || (leg.side === "sell" && leg.amountTokens === 0n))
      plan.deferred.push({
        ...numbered,
        reason: leg.valueE18 < minimum ? "Below minimum order" : "Sell rounds to zero raw tokens",
      });
    else plan.legs.push(numbered);
  };
  // Invest is buys only. Rebalance liquidates overweight positions, largest issuer value first.
  if (input.mode === "rebalance")
    for (const [i, current] of plan.before.entries()) {
      let excess = current.valueE18 - targets[i]!;
      if (excess <= 0n) continue;
      const price = input.prices[current.ticker]!.usdPerShareE18!;
      const holdings = input.holdings
        .filter(
          (h) =>
            h.ticker === current.ticker &&
            h.balanceTokens > 0n &&
            h.balanceShares !== null &&
            h.balanceShares > 0n,
        )
        .map((h) => ({ h, value: mulDiv(h.balanceShares!, price, E18) }))
        .sort((a, b) =>
          a.value === b.value
            ? a.h.tokenContractAddress
                .toLowerCase()
                .localeCompare(b.h.tokenContractAddress.toLowerCase())
            : a.value > b.value
              ? -1
              : 1,
        );
      for (const { h, value } of holdings) {
        if (excess <= 0n) break;
        if (h.issuer === null || h.issuer === "xstocks") {
          plan.unavailable.push({
            ticker: h.ticker,
            tokenContractAddress: h.tokenContractAddress,
            reason:
              h.issuer === "xstocks"
                ? "No market to exit this token on BNB Chain"
                : "Sell issuer unavailable",
          });
          continue;
        }
        const requested = min(excess, value);
        const shares = requested === value ? h.balanceShares! : mulDiv(requested, E18, price);
        const tokens =
          requested === value ? h.balanceTokens : mulDiv(shares, h.balanceTokens, h.balanceShares!);
        const actualShares =
          tokens === h.balanceTokens
            ? h.balanceShares!
            : mulDiv(tokens, h.balanceShares!, h.balanceTokens);
        const actualValue = mulDiv(actualShares, price, E18);
        add({
          id: `${template.id}:sell:${h.ticker}:${h.tokenContractAddress.toLowerCase()}`,
          side: "sell",
          ticker: h.ticker,
          issuer: h.issuer,
          tokenContractAddress: h.tokenContractAddress,
          amountTokens: tokens,
          amountSharesE18: actualShares,
          valueE18: actualValue,
          assumedProceedsUsdtE18: mulDiv(actualValue, BigInt(10000 - haircut), 10000n),
        });
        // Deferred sell value is never counted as funding; this slice belongs to this issuer.
        excess -= requested;
      }
    }
  const sells = plan.legs.filter((leg): leg is SellLeg => leg.side === "sell");
  plan.totals.sellValueE18 = sum(sells.map((l) => l.valueE18));
  plan.totals.assumedSellProceedsUsdtE18 = sum(sells.map((l) => l.assumedProceedsUsdtE18));
  const budget =
    input.mode === "rebalance"
      ? input.walletUsdtE18 + plan.totals.assumedSellProceedsUsdtE18
      : min(invest, input.walletUsdtE18);
  plan.totals.buyBudgetUsdtE18 = budget;
  const gaps = plan.target.map((h, i) =>
    h.valueE18 > plan.before[i]!.valueE18 ? h.valueE18 - plan.before[i]!.valueE18 : 0n,
  );
  const gapTotal = sum(gaps);
  const allocation = allocateExact(min(gapTotal, budget), gaps);
  if (budget < gapTotal)
    plan.notes.push("Buy budget is short; buys scaled down in proportion to under-weight gaps");
  if (input.mode !== "rebalance")
    plan.notes.push(
      "Invest mode buys only; spend is capped by the requested investment and wallet USDT",
    );
  for (const [i, h] of plan.target.entries()) {
    const amount = allocation[i]!;
    if (amount === 0n) continue;
    const issuer = input.bestIssuer(h.ticker);
    if (!issuer || issuer.issuer === "xstocks") {
      plan.unavailable.push({ ticker: h.ticker, reason: "No executable buy issuer available" });
      continue;
    }
    add({
      id: `${template.id}:buy:${h.ticker}:${issuer.tokenContractAddress.toLowerCase()}`,
      side: "buy",
      ticker: h.ticker,
      ...issuer,
      valueE18: amount,
      amountUsdtE18: amount,
    });
  }
  plan.totals.buyUsdtE18 = sum(plan.legs.filter((l) => l.side === "buy").map((l) => l.valueE18));
  plan.totals.unspentUsdtE18 = budget - plan.totals.buyUsdtE18;
  plan.totals.deferredSellValueE18 = sum(
    plan.deferred.filter((l) => l.side === "sell").map((l) => l.valueE18),
  );
  plan.totals.deferredBuyUsdtE18 = sum(
    plan.deferred.filter((l) => l.side === "buy").map((l) => l.valueE18),
  );
  if (plan.deferred.length)
    plan.notes.push(
      `Orders below ${formatUnits(minimum, 18)} USDT are deferred; small pies rebalance less often`,
    );
  if (!plan.legs.length) {
    plan.reason = plan.deferred.length
      ? "Pie is too small to rebalance at the minimum order size"
      : "No funded executable orders";
    plan.notes.push(plan.reason);
  }
  if (sells.length)
    plan.notes.push(
      `Sell proceeds are estimates with a ${haircut} bps haircut; execution must re-quote each user-signed leg`,
    );
  return plan;
}
