import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { E18, mulDiv } from "@tally/core";
import {
  allocateExact,
  applyLegResult,
  PIE_TEMPLATES,
  pieRunState,
  rebalancePlan,
  referencePerShare,
  templateAvailability,
  validateTemplate,
  valuePie,
  type PieHolding,
  type PieRun,
  type RebalanceInput,
  type SellLeg,
} from "./index";

const template = PIE_TEMPLATES[0]!;
const buyable = new Set(["NVDA", "AAPL", "TSLA", "QQQ", "SPY"]);
const holding = (
  ticker: string,
  shares: bigint,
  issuer: "ondo" | "bstock" = "bstock",
  tokens = shares,
): PieHolding => ({
  ticker,
  issuer,
  tokenContractAddress: `${ticker}-${issuer}`,
  balanceTokens: tokens,
  balanceShares: shares,
});
const base: RebalanceInput = {
  template,
  holdings: [holding("NVDA", 100n * E18)],
  prices: {
    NVDA: { usdPerShareE18: E18 },
    AAPL: { usdPerShareE18: E18 },
    TSLA: { usdPerShareE18: E18 },
  },
  buyable,
  walletUsdtE18: 0n,
  mode: "rebalance",
  bestIssuer: (ticker) => ({ issuer: "bstock", tokenContractAddress: `${ticker}-buy` }),
};

it("ships exactly four templates with the approved weights and advice copy", () => {
  expect(PIE_TEMPLATES.map((t) => t.id)).toEqual([
    "tech-trio",
    "index-core",
    "growth-five",
    "mag7-preview",
  ]);
  expect(PIE_TEMPLATES.map((t) => t.holdings.map((h) => h.targetWeightBps))).toEqual([
    [4000, 3500, 2500],
    [6000, 4000],
    [3000, 2500, 1500, 2000, 1000],
    [1429, 1429, 1429, 1429, 1428, 1428, 1428],
  ]);
  for (const t of PIE_TEMPLATES) {
    expect(t.description).toBe("Example allocation, not advice");
    expect(t.holdings.reduce((n, h) => n + h.targetWeightBps, 0)).toBe(10000);
  }
});
it("rejects weights not summing to 10000, duplicates, lowercase, fractional weights and malformed templates", () => {
  expect(() =>
    validateTemplate({ ...template, holdings: [{ ticker: "NVDA", targetWeightBps: 9999 }] }),
  ).toThrow("10000");
  expect(() =>
    validateTemplate({
      ...template,
      holdings: [
        { ticker: "NVDA", targetWeightBps: 5000 },
        { ticker: "NVDA", targetWeightBps: 5000 },
      ],
    }),
  ).toThrow("Duplicate");
  for (const value of [
    null,
    {},
    { ...template, holdings: [] },
    { ...template, holdings: [{ ticker: "nvda", targetWeightBps: 10000 }] },
    { ...template, holdings: [{ ticker: "NVDA", targetWeightBps: 9999.5 }] },
  ]) {
    expect(() => validateTemplate(value)).toThrow();
  }
});
it("lists unavailable Mag 7 tickers and prevents preview execution even when all tickers become buyable", () => {
  const mag7 = PIE_TEMPLATES[3]!;
  expect(templateAvailability(mag7, buyable).unavailable.map((h) => h.ticker)).toEqual([
    "MSFT",
    "AMZN",
    "GOOGL",
    "META",
  ]);
  expect(templateAvailability(mag7, new Set(mag7.holdings.map((h) => h.ticker))).executable).toBe(
    false,
  );
  expect(rebalancePlan({ ...base, buyable: new Set(["NVDA"]) }).legs).toEqual([]);
});
it("weights an Ondo 10-shares-per-token holding beside bStock 1:1 of the same ticker in SHARES", () => {
  const holdings = [
    holding("NVDA", 20n * E18, "ondo", 2n * E18),
    holding("NVDA", 10n * E18),
    holding("AAPL", 10n * E18),
  ];
  const value = valuePie(template, holdings, base.prices);
  expect(value.before.map((h) => [h.valueE18, h.weightBps])).toEqual([
    [30n * E18, 7500],
    [10n * E18, 2500],
    [0n, 0],
  ]);
});
it("sums shares before multiplying by price to retain fractional value wei", () => {
  const value = valuePie(template, [holding("NVDA", 1n, "ondo"), holding("NVDA", 1n)], {
    ...base.prices,
    NVDA: { usdPerShareE18: E18 / 2n },
  });
  expect(value.totalValueE18).toBe(1n);
});
it("unknown shares are excluded with their reason and refuse a plan, without assuming 1:1", () => {
  const bad = {
    ...holding("NVDA", E18),
    balanceShares: null,
    sharesUnavailableReason: "Multiplier observation missing",
  };
  const plan = rebalancePlan({ ...base, holdings: [bad, holding("AAPL", E18)] });
  expect(plan.excluded).toContainEqual({
    ticker: "NVDA",
    tokenContractAddress: bad.tokenContractAddress,
    reason: bad.sharesUnavailableReason,
  });
  expect(plan.totals.currentValueE18).toBe(E18);
  expect(plan.reason).toBe("cannot value NVDA");
  expect(plan.legs).toEqual([]);
});
it("null price excludes the entire ticker and refuses the plan with cannot value X", () => {
  const plan = rebalancePlan({
    ...base,
    prices: { ...base.prices, NVDA: { usdPerShareE18: null, reason: "Price source failed" } },
  });
  expect(plan.excluded).toContainEqual({ ticker: "NVDA", reason: "Price source failed" });
  expect(plan.totals.currentValueE18).toBe(0n);
  expect(plan.reason).toBe("cannot value NVDA");
  expect(plan.legs).toEqual([]);
});
it("recorded authenticated registry NVDA references convert to near $235 per share", () => {
  const recorded = JSON.parse(
    readFileSync(
      new URL("../../../spike/results/module_probes_20261003T130122Z.json", import.meta.url),
      "utf8",
    ),
  ) as {
    G_rwa_tokens_earnings: {
      data: {
        underlyingTicker: string;
        platformId: string;
        referencePrice: string;
        tokenToShareRatio: string;
      }[];
    };
  };
  const rows = recorded.G_rwa_tokens_earnings.data.filter((r) => r.underlyingTicker === "NVDA");
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    const price = referencePerShare(row).usdPerShareE18!;
    expect(price).toBeGreaterThan(233n * E18);
    expect(price).toBeLessThan(236n * E18);
  }
  expect(
    referencePerShare({ referencePrice: "680.8", tokenToShareRatio: "10" }).usdPerShareE18,
  ).toBe((6808n * E18) / 100n);
});
it("missing/invalid ratios and references carry reasons instead of assuming 1:1", () => {
  for (const row of [
    { referencePrice: "235" },
    { referencePrice: null, tokenToShareRatio: "1" },
    { referencePrice: "235", tokenToShareRatio: "0" },
    { referencePrice: "bad", tokenToShareRatio: "1" },
  ]) {
    expect(referencePerShare(row)).toMatchObject({
      usdPerShareE18: null,
      reason: expect.any(String),
    });
  }
});
it("sells precede buys with stable IDs and sequence, using a 1% haircut in the budget", () => {
  const plan = rebalancePlan(base);
  expect(plan.legs.map((l) => [l.side, l.sequence])).toEqual([
    ["sell", 1],
    ["buy", 2],
    ["buy", 3],
  ]);
  expect(plan.totals.sellValueE18).toBe(60n * E18);
  expect(plan.totals.buyBudgetUsdtE18).toBe((594n * E18) / 10n);
  expect(plan.totals.buyUsdtE18).toBe(plan.totals.buyBudgetUsdtE18);
  expect(plan.notes.join(" ")).toContain("scaled down");
  expect(rebalancePlan(base).legs.map((l) => l.id)).toEqual(plan.legs.map((l) => l.id));
});
it("splits sells across issuers largest value first and expresses them in RAW tokens", () => {
  const plan = rebalancePlan({
    ...base,
    template: {
      ...template,
      holdings: [
        { ticker: "NVDA", targetWeightBps: 1000 },
        { ticker: "AAPL", targetWeightBps: 9000 },
      ],
    },
    holdings: [
      holding("NVDA", 20n * E18, "bstock", 20n * 10n ** 6n),
      holding("NVDA", 80n * E18, "ondo", 8n * E18),
    ],
    sellHaircutBps: 0,
  });
  const sells = plan.legs.filter((l): l is SellLeg => l.side === "sell");
  expect(sells.map((l) => l.issuer)).toEqual(["ondo", "bstock"]);
  expect(sells[0]!.amountTokens).toBe(8n * E18); // exact full liquidation
  expect(sells[1]!.amountTokens).toBe(10n * 10n ** 6n);
  expect(sells.map((l) => l.amountSharesE18)).toEqual([80n * E18, 10n * E18]);
});
it("full liquidation uses the exact balance even with an awkward share ratio", () => {
  const raw = 123456789n;
  const plan = rebalancePlan({
    ...base,
    template: {
      ...template,
      holdings: [
        { ticker: "NVDA", targetWeightBps: 0 },
        { ticker: "AAPL", targetWeightBps: 10000 },
      ],
    },
    holdings: [holding("NVDA", 100n * E18 + 7n, "ondo", raw)],
  });
  expect((plan.legs[0] as SellLeg).amountTokens).toBe(raw);
});
it("partial sells use integer mulDiv and budget only the actual raw-token value", () => {
  const h = holding("NVDA", 100n * E18 + 7n, "ondo", 123456789n);
  const plan = rebalancePlan({ ...base, holdings: [h], sellHaircutBps: 0 });
  const sell = plan.legs[0] as SellLeg;
  expect(sell.amountTokens).toBe(
    mulDiv(plan.before[0]!.valueE18 - plan.target[0]!.valueE18, h.balanceTokens, h.balanceShares!),
  );
  expect(sell.amountTokens).toBeLessThan(h.balanceTokens);
  expect(plan.totals.buyUsdtE18).toBeLessThanOrEqual(sell.assumedProceedsUsdtE18);
});
it("sub-6 sells are deferred and never fund buys; a small pie says it is too small", () => {
  const plan = rebalancePlan({ ...base, holdings: [holding("NVDA", 8n * E18)] });
  expect(plan.legs).toEqual([]);
  expect(plan.deferred[0]).toMatchObject({
    side: "sell",
    valueE18: (48n * E18) / 10n,
    reason: "Below minimum order",
  });
  expect(plan.totals.buyBudgetUsdtE18).toBe(0n);
  expect(plan.reason).toContain("too small");
});
it("sub-6 buys are deferred with exact amounts and remain in unspent USDT", () => {
  const plan = rebalancePlan({
    ...base,
    holdings: [],
    walletUsdtE18: 10n * E18,
    mode: { invest: 10n * E18 },
  });
  expect(plan.deferred.map((l) => l.valueE18)).toEqual([
    4n * E18,
    (35n * E18) / 10n,
    (25n * E18) / 10n,
  ]);
  expect(plan.deferred.every((l) => l.side === "buy" && l.reason === "Below minimum order")).toBe(
    true,
  );
  expect(plan.totals.deferredBuyUsdtE18).toBe(10n * E18);
  expect(plan.totals.unspentUsdtE18).toBe(10n * E18);
});
it("orders exactly at 6 USDT are retained", () => {
  const plan = rebalancePlan({
    ...base,
    template: { ...template, holdings: [{ ticker: "NVDA", targetWeightBps: 10000 }] },
    holdings: [],
    walletUsdtE18: 6n * E18,
    mode: { invest: 6n * E18 },
  });
  expect(plan.legs).toHaveLength(1);
  expect(plan.deferred).toEqual([]);
});
it("buy amounts sum exactly with largest-remainder rounding and never exceed a short wallet budget", () => {
  const budget = 100n * E18 + 1n;
  const plan = rebalancePlan({
    ...base,
    holdings: [],
    walletUsdtE18: budget,
    mode: { invest: 200n * E18 },
  });
  expect(plan.legs.map((l) => l.valueE18)).toEqual([40n * E18 + 1n, 35n * E18, 25n * E18]);
  expect(plan.totals.buyUsdtE18).toBe(budget);
  expect(plan.legs.every((l) => l.side === "buy")).toBe(true);
  expect(plan.target.reduce((n, h) => n + h.valueE18, 0n)).toBe(200n * E18);
  for (let n = 1n; n <= 50n; n++) {
    const out = allocateExact(n, [2n, 3n, 7n]);
    expect(out.reduce((a, b) => a + b, 0n)).toBe(n);
  }
});
it("unavailable buy issuers stay visible and their allocation is not spent", () => {
  const plan = rebalancePlan({ ...base, bestIssuer: () => null });
  expect(plan.unavailable.map((h) => h.ticker)).toEqual(["AAPL", "TSLA"]);
  expect(plan.totals.buyUsdtE18).toBe(0n);
  expect(plan.totals.unspentUsdtE18).toBe(plan.totals.buyBudgetUsdtE18);
});
it("below-threshold drift produces no plan and the exact threshold triggers planning", () => {
  const holdings = [
    holding("NVDA", 44n * E18),
    holding("AAPL", 31n * E18),
    holding("TSLA", 25n * E18),
  ];
  expect(rebalancePlan({ ...base, holdings })).toMatchObject({
    legs: [],
    reason: "within threshold",
  });
  expect(
    rebalancePlan({
      ...base,
      holdings: [
        holding("NVDA", 45n * E18),
        holding("AAPL", 30n * E18),
        holding("TSLA", 25n * E18),
      ],
    }).reason,
  ).not.toBe("within threshold");
});
it("an empty pie produces no sell/buy plan", () => {
  expect(rebalancePlan({ ...base, holdings: [] })).toMatchObject({
    legs: [],
    reason: expect.stringContaining("Empty basket"),
  });
});
it("unrelated wallet holdings are outside the pie and remain untouched", () => {
  const plan = rebalancePlan({
    ...base,
    holdings: [...base.holdings, holding("SPY", 10000n * E18)],
  });
  expect(plan.totals.currentValueE18).toBe(100n * E18);
  expect(plan.legs.some((leg) => leg.ticker === "SPY")).toBe(false);
});
it("invest mode adds to a balanced pie without selling and caps spend by the request", () => {
  const plan = rebalancePlan({
    ...base,
    holdings: [holding("NVDA", 40n * E18), holding("AAPL", 35n * E18), holding("TSLA", 25n * E18)],
    walletUsdtE18: 1000n * E18,
    mode: { invest: 100n * E18 },
  });
  expect(plan.legs.every((leg) => leg.side === "buy")).toBe(true);
  expect(plan.totals.buyUsdtE18).toBe(100n * E18);
  expect(plan.totals.buyBudgetUsdtE18).toBe(100n * E18);
});
it("a failed leg records partial state, preserves every later pending leg and never retries", () => {
  const run: PieRun = {
    id: "run",
    wallet: "wallet",
    pieId: template.id,
    createdAt: 123,
    legs: rebalancePlan(base).legs.map((leg) => ({ id: leg.id, status: "pending" })),
  };
  const done = applyLegResult(run, run.legs[0]!.id, { status: "done", txHash: "0xabc" });
  const failed = applyLegResult(done, run.legs[1]!.id, {
    status: "failed",
    reason: "User rejected",
  });
  expect(pieRunState(failed)).toBe("partially rebalanced");
  expect(failed.legs.map((l) => l.status)).toEqual(["done", "failed", "pending"]);
  expect(failed.legs[0]!.txHash).toBe("0xabc");
  expect(failed.legs[1]!.reason).toBe("User rejected");
  expect(run.legs.every((l) => l.status === "pending")).toBe(true);
  expect(() => applyLegResult(failed, run.legs[1]!.id, { status: "done" })).toThrow("terminal");
  expect(() => applyLegResult(run, "missing", { status: "done" })).toThrow("Unknown");
});
