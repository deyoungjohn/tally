import { expect, it, vi } from "vitest";
import { E18 } from "@tally/core";
import { openStore } from "@tally/modkit";
import {
  applyLegResult,
  PIE_TEMPLATES,
  rebalancePlan,
  type PieRun,
  type RebalanceInput,
} from "@tally/mod-pies";
import { buildPieTemplatesVM, buildPieVM, buildRebalancePlanVM, loadPies } from "./view-model";
import { previewPies } from "./preview-fixture";

const base: RebalanceInput = {
  template: PIE_TEMPLATES[0]!,
  buyable: new Set(["NVDA", "AAPL", "TSLA", "QQQ", "SPY"]),
  holdings: [],
  prices: {
    NVDA: { usdPerShareE18: E18 },
    AAPL: { usdPerShareE18: E18 },
    TSLA: { usdPerShareE18: E18 },
  },
  walletUsdtE18: 0n,
  mode: "rebalance",
  bestIssuer: (ticker) => ({ issuer: "bstock", tokenContractAddress: `${ticker}-buy` }),
};
const holding = (ticker: string, shares: bigint) => ({
  ticker,
  issuer: "bstock" as const,
  tokenContractAddress: `${ticker}-bstock`,
  balanceTokens: shares,
  balanceShares: shares,
});
const meta = { stale: true, ageMs: 600000, source: "recorded", error: null };

it("empty pie VM explains missing observations and never claims a live source", async () => {
  expect(await loadPies()).toMatchObject({
    state: "empty",
    empty: true,
    stale: false,
    ageMs: null,
    source: null,
    reason: "Baskets have no observations yet.",
    error: null,
    pie: null,
  });
  expect(buildPieVM(base)).toMatchObject({
    state: "empty",
    empty: true,
    currentValueE18: "0",
    reason: "Empty basket",
  });
  expect(buildRebalancePlanVM(rebalancePlan(base))).toMatchObject({
    state: "empty",
    legs: [],
    reason: expect.stringContaining("Empty basket"),
  });
});
it("default templates use the expanded product list while Mag 7 stays a preview", async () => {
  const vm = await loadPies();
  const mag7 = vm.templates.templates.find((template) => template.id === "mag7-preview")!;
  expect(mag7.unavailable).toEqual([]);
  expect(mag7.executable).toBe(false);
  expect(vm.empty).toBe(true);
  expect(vm.plan.legs).toEqual([]);
});
it("below-threshold VM shows current vs target drift and no legs", () => {
  const input = {
    ...base,
    holdings: [holding("NVDA", 44n * E18), holding("AAPL", 31n * E18), holding("TSLA", 25n * E18)],
  };
  expect(buildPieVM(input).holdings.map((h) => h.driftBps)).toEqual([400, 400, 0]);
  expect(buildRebalancePlanVM(rebalancePlan(input))).toMatchObject({
    legs: [],
    empty: true,
    reason: "within threshold",
  });
});
it("partial VM preserves exact leg statuses, reasons and receipt hashes", () => {
  const plan = rebalancePlan({ ...base, holdings: [holding("NVDA", 100n * E18)] });
  const run: PieRun = {
    id: "r",
    wallet: "wallet",
    pieId: base.template.id,
    createdAt: 123,
    legs: plan.legs.map((l) => ({ id: l.id, status: "pending" })),
  };
  const done = applyLegResult(run, run.legs[0]!.id, { status: "done", txHash: "0xreceipt" });
  const failed = applyLegResult(done, run.legs[1]!.id, { status: "failed", reason: "Rejected" });
  const vm = buildRebalancePlanVM(plan, failed, meta);
  expect(vm.partialState).toBe("partially rebalanced");
  expect(vm.run).toEqual(failed);
  expect(vm.run!.legs.map((l) => l.status)).toEqual(["done", "failed", "pending"]);
  expect(vm).toMatchObject(meta);
  expect(JSON.parse(JSON.stringify(vm))).toEqual(vm);
});
it("all VMs are serialisable and expose unavailable and excluded facts visibly", () => {
  const templates = buildPieTemplatesVM(base.buyable);
  expect(templates.templates[3]!.unavailable.map((h) => h.ticker)).toEqual([
    "MSFT",
    "AMZN",
    "GOOGL",
    "META",
  ]);
  expect(templates.templates[3]!.executable).toBe(false);
  const pie = buildPieVM({
    ...base,
    holdings: [
      { ...holding("NVDA", E18), balanceShares: null, sharesUnavailableReason: "Missing ratio" },
    ],
  });
  expect(pie.holdings[0]!.fullyValued).toBe(false);
  expect(pie.executable).toBe(false);
  expect(pie.excluded[0]!.reason).toBe("Missing ratio");
  for (const vm of [pie, templates, previewPies()]) {
    expect(JSON.parse(JSON.stringify(vm))).toEqual(vm);
    expect(JSON.stringify(vm)).not.toContain('"asOf"');
  }
});
it("snapshot-only loader converts references per share and shows stale age with warnings", async () => {
  const store = openStore(":memory:");
  const onWarn = vi.fn();
  try {
    store.put({
      kind: "portfolio",
      key: "wallet",
      observedAt: 1000,
      source: "portfolio fixture",
      data: { holdings: [holding("NVDA", 100n * E18)] },
    });
    store.put({
      kind: "registry",
      key: "bsc",
      observedAt: 2000,
      source: "registry fixture",
      data: base.template.holdings.map((h) => ({
        binanceChainId: "56",
        underlyingTicker: h.ticker,
        tokenContractAddress: `${h.ticker}-bstock`,
        tokenSymbol: h.ticker,
        decimals: "18",
        platformId: "bstock",
        tokenToShareRatio: "10",
        referencePrice: "20",
      })),
    });
    store.put({
      kind: "prices",
      key: "bsc",
      observedAt: 3000,
      source: "price fixture",
      data: base.template.holdings.map((h) => ({
        binanceChainId: "56",
        tokenContractAddress: `${h.ticker}-bstock`,
        platformId: "bstock",
        tokenPrice: "10",
        referencePrice: "10",
        tokenPriceUpdatedAt: 3000,
      })),
    });
    const vm = await loadPies({
      wallet: "WALLET",
      store,
      now: 601000,
      walletUsdtE18: 0n,
      bestIssuer: base.bestIssuer,
      onWarn,
    });
    expect(vm).toMatchObject({ stale: true, ageMs: 600000, state: "ready" });
    expect(vm.pie!.currentValueE18).toBe((100n * E18).toString());
    expect(vm.plan.totals!.buyBudgetUsdtE18).toBe(((594n * E18) / 10n).toString());
    expect(onWarn).toHaveBeenCalledWith("portfolio snapshot is stale (600000 ms old)");
    expect(JSON.parse(JSON.stringify(vm))).toEqual(vm);
    expect(store.latest("pies", "wallet", { maxAgeMs: 1 })).toBeNull();
  } finally {
    store.close();
  }
});
it("missing price snapshot falls back to the registry, warns and keeps its source/age", async () => {
  const store = openStore(":memory:");
  const onWarn = vi.fn();
  try {
    store.put({
      kind: "portfolio",
      key: "wallet",
      observedAt: 1000,
      source: "portfolio",
      data: { holdings: [holding("NVDA", E18)] },
    });
    store.put({
      kind: "registry",
      key: "bsc",
      observedAt: 2000,
      source: "registry",
      data: base.template.holdings.map((h) => ({
        binanceChainId: "56",
        underlyingTicker: h.ticker,
        tokenContractAddress: h.ticker,
        tokenSymbol: h.ticker,
        platformId: "ondo",
        decimals: "18",
        tokenToShareRatio: "10",
        referencePrice: "2350",
      })),
    });
    const vm = await loadPies({ wallet: "wallet", store, now: 3000, onWarn });
    expect(vm.pie!.currentValueE18).toBe((235n * E18).toString());
    expect(vm.source).toBe("portfolio, registry");
    expect(vm.ageMs).toBe(2000);
    expect(onWarn).toHaveBeenCalledTimes(3);
    expect(vm.plan).toMatchObject({
      legs: [],
      reason: expect.stringContaining("Wallet USDT balance unavailable"),
    });
  } finally {
    store.close();
  }
});
it("missing registry/prices refuses valuation instead of guessing, even if portfolio embeds a USD value", async () => {
  const store = openStore(":memory:");
  try {
    store.put({
      kind: "portfolio",
      key: "wallet",
      observedAt: 1000,
      source: "portfolio",
      data: { holdings: [{ ...holding("NVDA", E18), tokenBalanceUsdE18: 235n * E18 }] },
    });
    const vm = await loadPies({ wallet: "wallet", store, now: 1000, walletUsdtE18: 100n * E18 });
    expect(vm.pie!.excluded).toHaveLength(3);
    expect(vm.plan.reason).toBe("cannot value NVDA, AAPL, TSLA");
    expect(vm.plan.legs).toEqual([]);
  } finally {
    store.close();
  }
});
it("snapshot source failure produces error states and calls onWarn without network/retry", async () => {
  const store = openStore(":memory:");
  const onWarn = vi.fn();
  try {
    const latest = vi.spyOn(store, "latest").mockImplementation(() => {
      throw new Error("Store unavailable");
    });
    const vm = await loadPies({ wallet: "wallet", store, onWarn });
    expect(vm.state).toBe("error");
    expect(vm.plan.state).toBe("error");
    expect(vm.templates.state).toBe("error");
    expect(vm.error).toContain("Store unavailable");
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(latest).toHaveBeenCalledTimes(1);
  } finally {
    store.close();
  }
});
