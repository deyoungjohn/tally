import { expect, it } from "vitest";
import { E18 } from "@tally/core";
import { buildPiesPageVM } from "./view-model";

it("projects the bStock basket, minimum budget and serialisable budget plan", () => {
  const vm = buildPiesPageVM({ budgetUsdt: 30n * E18, fixtures: true });
  expect(vm.baskets[0]?.name).toBe("Big Tech");
  expect(vm.baskets[0]?.minimumBudgetUsdt).toBe((30n * E18).toString());
  expect(vm.baskets[0]?.tokens.map((token) => token.symbol)).toEqual([
    "NVDAB",
    "AAPLB",
    "GOOGLB",
    "MSFTB",
    "METAB",
  ]);
  expect(vm.plan?.totalUsdt).toBe((30n * E18).toString());
  expect(vm.label).toBe("Fixture data");
  expect(JSON.parse(JSON.stringify(vm))).toEqual(vm);
});
it("keeps missing issuer and price facts visible and never guesses share amounts", () => {
  const vm = buildPiesPageVM({
    budgetUsdt: 60n * E18,
    enabled: new Set(["NVDA", "AAPL", "GOOGL", "MSFT"]),
    pricesE18: { NVDA: 200n * E18 },
    meta: { source: "recorded", stale: true, ageMs: 600000, error: null },
  });
  expect(vm.baskets[0]?.tokens[4]).toMatchObject({
    executable: false,
    reason: "METAB isn’t enabled in Tally yet",
  });
  expect(vm.plan?.deferred[0]?.symbol).toBe("METAB");
  expect(vm.plan?.legs[0]?.approximateSharesE18).toBe(((6n * E18) / 100n).toString());
  expect(vm.plan?.legs[1]).toMatchObject({
    approximateSharesE18: null,
    sharesReason: expect.stringContaining("snapshot"),
  });
  expect(vm).toMatchObject({ stale: true, ageMs: 600000, source: "recorded" });
});
it("empty templates, bad weights and source errors have explicit VM states", () => {
  expect(buildPiesPageVM({ templates: [] })).toMatchObject({ state: "empty", empty: true });
  expect(buildPiesPageVM({ budgetUsdt: 30n * E18, weightsBps: { NVDA: 10000 } })).toMatchObject({
    state: "error",
    error: expect.stringContaining("ticker"),
  });
  expect(
    buildPiesPageVM({
      budgetUsdt: 30n * E18,
      meta: { stale: true, ageMs: 300000, source: "failed snapshot", error: "Source unavailable" },
    }),
  ).toMatchObject({ state: "error", error: "Source unavailable", plan: null });
});
it("the selected basket minimum follows the requested nonzero-weight legs", () => {
  const vm = buildPiesPageVM({
    budgetUsdt: (1801n * E18) / 100n,
    weightsBps: { NVDA: 3333, AAPL: 3333, GOOGL: 3334, MSFT: 0, META: 0 },
  });
  expect(vm.baskets[0]?.minimumBudgetUsdt).toBe((18n * E18).toString());
  expect(vm.plan?.unspentUsdt).toBe((E18 / 100n).toString());
  expect(vm.baskets[0]?.tokens.map((token) => token.weightBps)).toEqual([3333, 3333, 3334, 0, 0]);
});
