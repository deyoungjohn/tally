import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTradeStageSubscribersForTests,
  createIntentId,
  dispatchTradeStage,
  getTradeStageSubscriberCount,
  subscribeTradeStage,
  type IntentStagePayload,
  type QuoteStagePayload,
  type RealizedStagePayload,
  type SignedStagePayload,
  type SimulationStagePayload,
  type TradeStage,
} from "./trade-stages";

describe("trade-stages contract and registry", () => {
  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = globalThis;
    clearTradeStageSubscribersForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearTradeStageSubscribersForTests();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("generates unique intent IDs", () => {
    const id1 = createIntentId();
    const id2 = createIntentId();
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  it("subscribes and unsubscribes global listeners", () => {
    const events: Array<{ stage: TradeStage; id: string }> = [];
    const unsubscribe = subscribeTradeStage((stage, payload) => {
      events.push({ stage, id: payload.intentId });
    });

    expect(getTradeStageSubscriberCount()).toBe(1);

    const intentPayload: IntentStagePayload = {
      stage: "intent",
      intentId: "test-intent-1",
      attempt: 1,
      timestamp: Date.now(),
      ticker: "NVDA",
      issuer: "bstock",
      symbol: "NVDAB",
      usd: 25,
      tolerancePct: 1,
      user: "0x1111111111111111111111111111111111111111",
    };

    dispatchTradeStage("intent", intentPayload);
    expect(events).toEqual([{ stage: "intent", id: "test-intent-1" }]);

    unsubscribe();
    expect(getTradeStageSubscriberCount()).toBe(0);

    dispatchTradeStage("intent", { ...intentPayload, intentId: "test-intent-2" });
    expect(events).toHaveLength(1);
  });

  it("delivers each event exactly once to both hook onStage and global subscriber without duplicates", () => {
    const globalEvents: string[] = [];
    const localEvents: string[] = [];

    const globalListener = vi.fn((stage, payload) => {
      globalEvents.push(`${stage}:${payload.intentId}`);
    });
    const localListener = vi.fn((stage, payload) => {
      localEvents.push(`${stage}:${payload.intentId}`);
    });

    const unsubscribe = subscribeTradeStage(globalListener);

    const quotePayload: QuoteStagePayload = {
      stage: "quote",
      intentId: "intent-123",
      attempt: 1,
      timestamp: 1700000000000,
      ticker: "NVDA",
      issuer: "ondo",
      symbol: "NVDAon",
      stock: "0x2222222222222222222222222222222222222222",
      guard: "0x3333333333333333333333333333333333333333",
      amountInUsdt: "25000000000000000000",
      tokensOut: "107142857142857142",
      quotedShares: "1071428571428571420",
      minShares: "1060714285714285705",
      multiplier: "10000000000000000000",
      usdPerShare: 233.33,
      referencePrice: 233.5,
      premium: -0.0007,
      routeText: "LiquidMesh > NVDAon",
      hops: 1,
      vendor: "LiquidMesh",
      feedUpdate: false,
      builtAt: 1700000000000,
      expiresAt: 1700000015000,
      isRequote: false,
      warnings: [],
    };

    dispatchTradeStage("quote", quotePayload, localListener);

    expect(globalListener).toHaveBeenCalledTimes(1);
    expect(localListener).toHaveBeenCalledTimes(1);
    expect(globalEvents).toEqual(["quote:intent-123"]);
    expect(localEvents).toEqual(["quote:intent-123"]);

    // If the exact same listener function was passed both locally and globally, it is deduplicated
    globalListener.mockClear();
    dispatchTradeStage("quote", quotePayload, globalListener);
    expect(globalListener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("safely catches synchronous subscriber errors and logs console.warn without re-throwing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const failingListener = vi.fn(() => {
      throw new Error("Subscriber crash");
    });
    const normalListener = vi.fn();

    const unsubscribe = subscribeTradeStage(failingListener);

    const signedPayload: SignedStagePayload = {
      stage: "signed",
      intentId: "intent-err",
      attempt: 1,
      timestamp: Date.now(),
      txHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      isResumed: false,
      ticker: "NVDA",
      symbol: "NVDAB",
    };

    expect(() => {
      dispatchTradeStage("signed", signedPayload, normalListener);
    }).not.toThrow();

    expect(failingListener).toHaveBeenCalledTimes(1);
    expect(normalListener).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[TradeStages] subscriber threw on stage 'signed':"),
      expect.any(Error),
    );

    unsubscribe();
  });

  it("safely catches asynchronous rejected promises in subscribers and logs console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rejectingListener = vi.fn(async () => {
      throw new Error("Async failure in persistence");
    });

    const unsubscribe = subscribeTradeStage(rejectingListener);

    const realizedPayload: RealizedStagePayload = {
      stage: "realized",
      intentId: "intent-async",
      attempt: 1,
      timestamp: Date.now(),
      txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      status: "success",
      isResumed: false,
      blockNumber: 123456,
      gasUsed: 450000,
      gasUsd: 0.02,
      bscscan: "https://bscscan.com/tx/0x1111",
      fill: {
        tokensOut: "100000000000000000",
        shares: "1000000000000000000",
        multiplier: "10000000000000000000",
        amountInUsdt: "25000000000000000000",
        usdPerShare: 25,
        referencePrice: 25,
        premium: 0,
        stock: "0xstock",
        user: "0xuser",
      },
    };

    expect(() => {
      dispatchTradeStage("realized", realizedPayload);
    }).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[TradeStages] subscriber rejected on stage 'realized':"),
      expect.any(Error),
    );

    unsubscribe();
  });

  it("supports honest missing simulation evidence as well as available simulation", () => {
    const records: SimulationStagePayload[] = [];
    const unsubscribe = subscribeTradeStage((stage, payload) => {
      if (stage === "simulation") {
        records.push(payload as SimulationStagePayload);
      }
    });

    const missingPayload: SimulationStagePayload = {
      stage: "simulation",
      intentId: "sim-missing",
      attempt: 1,
      timestamp: 1000,
      available: false,
      missingReason: "Simulation deferred: token allowance approval required",
    };

    dispatchTradeStage("simulation", missingPayload);

    const availablePayload: SimulationStagePayload = {
      stage: "simulation",
      intentId: "sim-ok",
      attempt: 2,
      timestamp: 2000,
      available: true,
      ethCall: "ok",
      binance: "ok",
      gasEstimate: "450000",
      gasLimit: "562500",
      missingReason: null,
    };

    dispatchTradeStage("simulation", availablePayload);

    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(missingPayload);
    expect(records[1]).toEqual(availablePayload);

    unsubscribe();
  });

  it("is a no-op on the server when window is undefined", () => {
    delete (globalThis as unknown as { window?: unknown }).window;

    const listener = vi.fn();
    const unsub = subscribeTradeStage(listener);
    expect(getTradeStageSubscriberCount()).toBe(0);

    dispatchTradeStage(
      "intent",
      {
        stage: "intent",
        intentId: "server-test",
        attempt: 1,
        timestamp: 1000,
        ticker: "NVDA",
        issuer: "bstock",
        symbol: "NVDAB",
        usd: 10,
        tolerancePct: 1,
        user: "0xuser",
      },
      listener,
    );

    expect(listener).not.toHaveBeenCalled();
    expect(typeof unsub).toBe("function");
    unsub();
  });
});
