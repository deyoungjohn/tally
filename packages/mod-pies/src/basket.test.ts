import { expect, it } from "vitest";
import { E18 } from "@tally/core";
import { basketBuyPlan, BIG_TECH, PIE_TEMPLATES, USDT_CENT } from "./index";

const enabled = new Set(BIG_TECH.holdings.map((holding) => holding.ticker));
it("adds Big Tech without changing the four existing templates", () => {
  expect(PIE_TEMPLATES).toHaveLength(4);
  expect(BIG_TECH.holdings.map((holding) => holding.ticker)).toEqual([
    "NVDA",
    "AAPL",
    "GOOGL",
    "MSFT",
    "META",
  ]);
  expect(BIG_TECH.holdings.every((holding) => holding.targetWeightBps === 2000)).toBe(true);
  expect(BIG_TECH.issuer).toBe("bstock");
});
it.each([30, 60])("allocates equal weights within a $%i budget", (budget) => {
  const plan = basketBuyPlan({ template: BIG_TECH, budgetUsdt: BigInt(budget) * E18, enabled });
  expect(plan.legs.map((leg) => leg.amountUsdt)).toEqual(
    Array(5).fill((BigInt(budget) * E18) / 5n),
  );
  expect(plan.legs.every((leg) => leg.executable)).toBe(true);
  expect(plan.totalUsdt).toBe(BigInt(budget) * E18);
  expect(plan.unspentUsdt).toBe(0n);
});
it("lists sub-minimum and disabled legs without merging or reallocating their budget", () => {
  const plan = basketBuyPlan({
    template: BIG_TECH,
    budgetUsdt: 30n * E18,
    weightsBps: { NVDA: 1000, AAPL: 3000, GOOGL: 2000, MSFT: 2000, META: 2000 },
    enabled: new Set(["NVDA", "AAPL", "GOOGL", "MSFT"]),
  });
  expect(plan.deferred.map((leg) => leg.symbol)).toEqual(["NVDAB", "METAB"]);
  expect(plan.deferred[0]).toMatchObject({
    amountUsdt: 3n * E18,
    reason: expect.stringContaining("minimum"),
  });
  expect(plan.deferred[1]).toMatchObject({
    amountUsdt: 6n * E18,
    reason: "METAB isn’t enabled in Tally yet",
  });
  expect(plan.totalUsdt).toBe(21n * E18);
  expect(plan.unspentUsdt).toBe(9n * E18);
});
it("rejects invalid weights, unknown tickers and invalid budgets", () => {
  for (const weight of [1999, -1, 2000.5, NaN, Infinity]) {
    expect(() =>
      basketBuyPlan({
        template: BIG_TECH,
        budgetUsdt: 30n * E18,
        enabled,
        weightsBps: { NVDA: weight, AAPL: 2000, GOOGL: 2000, MSFT: 2000, META: 2000 },
      }),
    ).toThrow(/weights/);
  }
  expect(() => basketBuyPlan({ template: BIG_TECH, budgetUsdt: -1n, enabled })).toThrow(/Budget/);
  expect(() =>
    basketBuyPlan({ template: BIG_TECH, budgetUsdt: E18, enabled, weightsBps: { UNKNOWN: 10000 } }),
  ).toThrow(/ticker/);
});
it("rounds every leg down to cents and exposes all unspent dust", () => {
  const budgetUsdt = 60n * E18 + 4n * USDT_CENT + 123n;
  const plan = basketBuyPlan({ template: BIG_TECH, budgetUsdt, enabled });
  expect(plan.legs.every((leg) => leg.amountUsdt % USDT_CENT === 0n)).toBe(true);
  expect(plan.totalUsdt).toBe(60n * E18);
  expect(plan.unspentUsdt).toBe(4n * USDT_CENT + 123n);
  expect(plan.legs.reduce((sum, leg) => sum + leg.amountUsdt, 0n)).toBeLessThanOrEqual(budgetUsdt);
});
it("defers every leg when the budget is below one minimum buy, including empty budget", () => {
  for (const budgetUsdt of [0n, 5n * E18]) {
    const plan = basketBuyPlan({ template: BIG_TECH, budgetUsdt, enabled });
    expect(plan.deferred).toHaveLength(5);
    expect(plan.totalUsdt).toBe(0n);
    expect(plan.unspentUsdt).toBe(budgetUsdt);
  }
});
it("does not round a $5.99 leg up to bypass the minimum", () => {
  const plan = basketBuyPlan({
    template: BIG_TECH,
    budgetUsdt: 18n * E18,
    enabled,
    weightsBps: { NVDA: 3333, AAPL: 3333, GOOGL: 3334, MSFT: 0, META: 0 },
  });
  expect(plan.legs.slice(0, 3).map((leg) => leg.amountUsdt)).toEqual([
    599n * USDT_CENT,
    599n * USDT_CENT,
    6n * E18,
  ]);
  expect(plan.totalUsdt).toBe(6n * E18);
});
it("the approved $18.01 three-leg example spends $18 and leaves one cent", () => {
  const plan = basketBuyPlan({
    template: BIG_TECH,
    budgetUsdt: 1801n * USDT_CENT,
    enabled,
    weightsBps: { NVDA: 3333, AAPL: 3333, GOOGL: 3334, MSFT: 0, META: 0 },
  });
  expect(plan.legs.filter((leg) => leg.executable).map((leg) => leg.amountUsdt)).toEqual(
    Array(3).fill(6n * E18),
  );
  expect(plan.totalUsdt).toBe(18n * E18);
  expect(plan.unspentUsdt).toBe(USDT_CENT);
});
