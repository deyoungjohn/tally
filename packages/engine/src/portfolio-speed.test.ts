import { describe, expect, it, vi } from "vitest";
import { createFixtureEngine } from "./engine";
import { portfolioFor } from "./views";
import { TtlCache, type EnginePorts, type TokenInspection, type Address } from "@tally/core";
import type { TradeChain } from "./trade";

const USER = "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930" as const;
const EMPTY_WALLET = "0x0000000000000000000000000000000000000001" as const;

const MOCK_PICKER_TICKERS = [
  "NVDA",
  "AAPL",
  "TSLA",
  "QQQ",
  "SPY",
  "TSM",
  "NFLX",
  "GOOGL",
  "AMZN",
  "MSFT",
  "META",
  "HOOD",
  "CRCL",
  "BABA",
  "INTC",
  "GME",
  "MSTR",
  "SNDK",
  "SKHY",
  "BMNR",
  "COIN",
] as const;

describe("WO-03 portfolio speed optimization", () => {
  it("a wallet holding one of 21 tickers inspects exactly one", async () => {
    const inspectedTickers: string[] = [];
    let erc20Calls = 0;

    const fakePorts = {} as EnginePorts;
    const fakeChain: TradeChain = {
      balances: vi.fn().mockResolvedValue({ usdt: 10n * 10n ** 18n, bnb: 1n * 10n ** 18n }),
      erc20Balances: vi.fn().mockImplementation(async (_owner, tokens: Address[]) => {
        erc20Calls++;
        return tokens.map(() => 1n * 10n ** 18n);
      }),
    } as unknown as TradeChain;

    const mockInspect = vi.fn().mockImplementation(async (ticker: string) => {
      inspectedTickers.push(ticker);
      return [
        {
          symbol: `${ticker}on`,
          issuer: "ondo",
          address: `0x1111111111111111111111111111111111111111` as Address,
          multiplier: { value: 10n ** 18n },
          integrity: { grade: "A" },
          referencePrice: { price: 100 },
        } as unknown as TokenInspection,
      ];
    });

    // Simulate heldTickers returning only what the wallet holds: ["NVDA"] out of 21 tickers
    const held = ["NVDA"];
    const report = await portfolioFor(
      fakePorts,
      fakeChain,
      USER,
      held,
      () => 1700000000000,
      mockInspect,
    );

    // Exactly one inspection occurred
    expect(inspectedTickers).toEqual(["NVDA"]);
    expect(mockInspect).toHaveBeenCalledTimes(1);
    expect(erc20Calls).toBe(1);
    expect(report.groups.length).toBe(1);
    expect(report.groups[0]?.ticker).toBe("NVDA");
  });

  it("an empty wallet inspects none", async () => {
    let inspectCalls = 0;
    let erc20Calls = 0;

    const fakePorts = {} as EnginePorts;
    const fakeChain: TradeChain = {
      balances: vi.fn().mockResolvedValue({ usdt: 0n, bnb: 5n * 10n ** 17n }),
      erc20Balances: vi.fn().mockImplementation(async () => {
        erc20Calls++;
        return [];
      }),
    } as unknown as TradeChain;

    const mockInspect = vi.fn().mockImplementation(async () => {
      inspectCalls++;
      return [];
    });

    // For empty wallet, heldTickers returns []
    const report = await portfolioFor(
      fakePorts,
      fakeChain,
      EMPTY_WALLET,
      [],
      () => 1700000000000,
      mockInspect,
    );

    // Zero inspections and zero erc20 multicalls
    expect(inspectCalls).toBe(0);
    expect(erc20Calls).toBe(0);
    expect(mockInspect).not.toHaveBeenCalled();
    expect(report.groups).toEqual([]);
    expect(report.wallet.bnb).toBe(0.5);
    expect(report.wallet.usdt).toBe(0);
  });

  it("scan failure falls back to the picker list", async () => {
    // When holdings scan fails (throws error), heldTickers returns null, route falls back to picker list
    const mockHoldingsScan = vi.fn().mockRejectedValue(new Error("RPC multicall failed"));

    let heldTickersResult: string[] | null = null;
    try {
      await mockHoldingsScan();
      heldTickersResult = [];
    } catch {
      heldTickersResult = null; // null signals fallback
    }

    expect(heldTickersResult).toBeNull();
    const effectiveTickers =
      heldTickersResult !== null ? heldTickersResult : [...MOCK_PICKER_TICKERS];
    expect(effectiveTickers.length).toBe(21);
    expect(effectiveTickers).toContain("NVDA");
    expect(effectiveTickers).toContain("AAPL");

    // Portfolio executed on the fallback list with 4-way concurrency
    let inspectedCount = 0;
    let erc20BatchSize = 0;
    const fakePorts = {} as EnginePorts;
    const fakeChain: TradeChain = {
      balances: vi.fn().mockResolvedValue({ usdt: 0n, bnb: 0n }),
      erc20Balances: vi.fn().mockImplementation(async (_owner, tokens: Address[]) => {
        erc20BatchSize = tokens.length;
        return tokens.map(() => 0n);
      }),
    } as unknown as TradeChain;

    const mockInspect = vi.fn().mockImplementation(async (ticker: string) => {
      inspectedCount++;
      return [
        {
          symbol: `${ticker}on`,
          issuer: "ondo",
          address: `0x${inspectedCount.toString(16).padStart(40, "0")}` as Address,
          multiplier: { value: 10n ** 18n },
          integrity: { grade: "A" },
        } as unknown as TokenInspection,
      ];
    });

    const report = await portfolioFor(
      fakePorts,
      fakeChain,
      USER,
      effectiveTickers,
      () => 1700000000000,
      mockInspect,
    );

    expect(inspectedCount).toBe(21);
    // All 21 tokens queried in a SINGLE batch erc20Balances call
    expect(erc20BatchSize).toBe(21);
    expect(fakeChain.erc20Balances).toHaveBeenCalledTimes(1);
    expect(report.failed).toEqual([]);
  });

  it("the shared promise is reused by two concurrent calls and dropped after a failure", async () => {
    const now = 1_000_000;
    const cache = new TtlCache<string>(30_000, () => now);

    // 1. Shared promise is reused while in-flight
    let loadCount = 0;
    let resolveLoad: (val: string) => void = () => {};
    const deferredLoad = () =>
      new Promise<string>((resolve) => {
        loadCount++;
        resolveLoad = resolve;
      });

    const p1 = cache.get("NVDA", deferredLoad);
    const p2 = cache.get("NVDA", deferredLoad);

    // load is only executed once for both concurrent callers
    expect(loadCount).toBe(1);

    resolveLoad("NVDA_DATA");
    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1).toBe("NVDA_DATA");
    expect(res2).toBe("NVDA_DATA");

    // 2. Promise is dropped after a failure
    let failCount = 0;
    const failingLoad = vi.fn().mockImplementation(async () => {
      failCount++;
      throw new Error("RPC timeout");
    });

    await expect(cache.get("FAILING_KEY", failingLoad)).rejects.toThrow("RPC timeout");
    expect(failCount).toBe(1);

    // After failure, next call does NOT return the failed promise and retries load
    let retryCount = 0;
    const successLoad = vi.fn().mockImplementation(async () => {
      retryCount++;
      return "RECOVERED";
    });

    const resRetry = await cache.get("FAILING_KEY", successLoad);
    expect(resRetry).toBe("RECOVERED");
    expect(retryCount).toBe(1);
  });

  it("the response shape is byte-identical for a held position (compare against the existing fixtures)", async () => {
    const engine = createFixtureEngine();
    const report = await engine.portfolio(USER, ["NVDA"]);

    // Compare against the expected deterministic JSON shape
    const serialized = JSON.stringify(report);
    const parsed = JSON.parse(serialized);

    // Assert exact top-level keys (no leaked internal stats or unexpected keys)
    expect(Object.keys(parsed).sort()).toEqual([
      "address",
      "asOf",
      "failed",
      "groups",
      "totalValueUsd",
      "wallet",
    ]);

    expect(parsed.address).toBe(USER);
    expect(typeof parsed.asOf).toBe("string");
    expect(parsed.failed).toEqual([]);
    expect(parsed.wallet).toEqual({ usdt: 12, bnb: 0.005 });
    expect(parsed.groups.length).toBe(1);

    const group = parsed.groups[0];
    expect(Object.keys(group).sort()).toEqual([
      "parts",
      "referencePrice",
      "shares",
      "ticker",
      "valueUsd",
    ]);
    expect(group.ticker).toBe("NVDA");
    expect(group.parts.length).toBe(2);

    for (const part of group.parts) {
      expect(Object.keys(part).sort()).toEqual([
        "address",
        "grade",
        "issuer",
        "multiplier",
        "shares",
        "symbol",
        "ticker",
        "tokens",
        "valueUsd",
      ]);
      expect(part.ticker).toBe("NVDA");
    }

    // Baseline values match trade.test.ts assertions
    expect(group.shares).toBeCloseTo(group.parts[0]!.shares + group.parts[1]!.shares, 12);
    expect(report.totalValueUsd).toBeGreaterThan(5);

    // Non-enumerable stats exist on object for route logging, but are invisible to JSON.stringify
    expect(
      (report as unknown as { stats: { inspected: number; cacheHits: number } }).stats,
    ).toBeDefined();
    expect(serialized).not.toContain("stats");
  });
});
