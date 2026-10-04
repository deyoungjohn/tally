import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { PlanDto, ReceiptDto } from "@/lib/dto";
import {
  clearTradeStageSubscribersForTests,
  subscribeTradeStage,
  type TradeStage,
  type TradeStagePayloadMap,
} from "./trade-stages";
import { useTradeFlow, type FlowParams, type TradeFlowOptions } from "./use-trade-flow";

// Setup minimal DOM environment for React 19 testing in Node
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class HTMLElement {}
class HTMLIFrameElement extends HTMLElement {}
(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = HTMLElement;
(globalThis as unknown as { HTMLIFrameElement: unknown }).HTMLIFrameElement = HTMLIFrameElement;

function createMockContainer() {
  const style = {};
  const mockEl: unknown = {
    nodeType: 1,
    tagName: "DIV",
    style,
    ownerDocument: null,
    firstChild: null,
    lastChild: null,
    childNodes: [],
    removeChild: () => {},
    appendChild: () => {},
    insertBefore: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    removeAttribute: () => {},
  };
  const mockDoc = {
    nodeType: 9,
    defaultView: globalThis,
    createElement: () => mockEl,
    createElementNS: () => mockEl,
    createTextNode: (t: string) => ({ nodeType: 3, textContent: t }),
    createComment: () => ({ nodeType: 8 }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  (mockEl as { ownerDocument: unknown }).ownerDocument = mockDoc;
  return { mockEl, mockDoc };
}

const { mockDoc } = createMockContainer();
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { document: unknown }).document = mockDoc;

const storage = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, val: string) => storage.set(key, val),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};

let currentWallet = {
  authenticated: true,
  address: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  sendTx: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};

vi.mock("@/components/wallet/wallet-context", () => ({
  useTallyWallet: () => currentWallet,
}));

type RecordedEvent = {
  stage: TradeStage;
  payload: TradeStagePayloadMap[TradeStage];
};

function setupTestHook(options?: TradeFlowOptions) {
  const { mockEl, mockDoc: doc } = createMockContainer();
  (globalThis as unknown as { document: unknown }).document = doc;

  let flowResult: ReturnType<typeof useTradeFlow> = null!;
  function TestComp() {
    flowResult = useTradeFlow(options);
    return null;
  }
  const root = createRoot(mockEl as unknown as Parameters<typeof createRoot>[0]);
  act(() => {
    root.render(createElement(TestComp));
  });
  return {
    getFlow: () => flowResult,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useTradeFlow typed stage events (WO-01)", () => {
  const defaultParams: FlowParams = {
    ticker: "NVDA",
    issuer: "bstock",
    symbol: "NVDAB",
    usd: 25,
    tolerancePct: 1,
  };

  const getReadyPlan = (overrides: Partial<PlanDto> = {}): PlanDto => ({
    status: "ready",
    builtAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    ticker: "NVDA",
    issuer: "bstock",
    symbol: "NVDAB",
    stock: "0x2222222222222222222222222222222222222222",
    guard: "0x3333333333333333333333333333333333333333",
    tolerancePct: 1,
    amountInUsdt: "25000000000000000000",
    tokensOut: "107142857142857142",
    quotedShares: "1071428571428571420",
    minShares: "1060714285714285705",
    multiplier: "10000000000000000000",
    usdPerShare: 233.33,
    referencePrice: 233.5,
    premium: -0.0007,
    routeText: "PancakeSwap V3 > NVDAB",
    hops: 1,
    vendor: "PancakeSwap",
    feedUpdate: false,
    balances: { usdt: "50000000000000000000", bnb: "100000000000000000" },
    tx: {
      to: "0x3333333333333333333333333333333333333333",
      data: "0xabcdef",
      value: "0x0",
      gasEstimate: "450000",
      gasLimit: "562500",
      gasPriceWei: "3000000000",
      feeUsd: 0.02,
      deadline: Math.floor(Date.now() / 1000) + 300,
      chainId: 56,
    },
    simulation: {
      ethCall: "ok",
      binance: "ok",
    },
    warnings: [],
    ...overrides,
  });

  const sampleSuccessReceipt: ReceiptDto = {
    status: "success",
    txHash: "0xaaaa1111222233334444555566667777888899990000aaaabbbbccccddddeeee0001",
    blockNumber: 42000001,
    gasUsed: 448000,
    gasUsd: 0.021,
    bscscan: "https://bscscan.com/tx/0xaaaa1111...",
    fill: {
      tokensOut: "107142857142857142",
      shares: "1071428571428571420",
      multiplier: "10000000000000000000",
      amountInUsdt: "25000000000000000000",
      usdPerShare: 233.33,
      referencePrice: 233.5,
      premium: -0.0007,
      stock: "0x2222222222222222222222222222222222222222",
      user: "0x1111111111111111111111111111111111111111",
    },
  };

  beforeEach(() => {
    clearTradeStageSubscribersForTests();
    storage.clear();
    vi.restoreAllMocks();
    currentWallet = {
      authenticated: true,
      address: "0x1111111111111111111111111111111111111111",
      sendTx: vi.fn().mockResolvedValue(sampleSuccessReceipt.txHash),
      login: vi.fn(),
      logout: vi.fn(),
    };
  });

  afterEach(() => {
    clearTradeStageSubscribersForTests();
    storage.clear();
  });

  it("proves all five typed stages fire in order with shared correlation and lossless string amounts", async () => {
    const recordedEvents: RecordedEvent[] = [];
    const plan = getReadyPlan();

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/trade/plan") {
        return {
          ok: true,
          json: async () => plan,
        };
      }
      if (url.includes("/api/trade/receipt")) {
        return {
          ok: true,
          json: async () => sampleSuccessReceipt,
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const harness = setupTestHook({
      onStage: (stage, payload) => {
        recordedEvents.push({ stage, payload });
      },
    });

    // 1. Start trade
    await act(async () => {
      harness.getFlow().start(defaultParams);
    });

    // Should have emitted intent, quote, simulation
    expect(harness.getFlow().phase.name).toBe("review");
    expect(recordedEvents.map((e) => e.stage)).toEqual(["intent", "quote", "simulation"]);

    const intentId = recordedEvents[0]?.payload.intentId;
    expect(intentId).toBeTruthy();

    // Verify intent payload
    expect(recordedEvents[0]?.payload).toMatchObject({
      stage: "intent",
      intentId,
      attempt: 1,
      ticker: "NVDA",
      issuer: "bstock",
      symbol: "NVDAB",
      usd: 25,
      tolerancePct: 1,
      user: "0x1111111111111111111111111111111111111111",
    });

    // Verify quote payload: amounts are lossless integer strings
    expect(recordedEvents[1]?.payload).toMatchObject({
      stage: "quote",
      intentId,
      attempt: 1,
      amountInUsdt: "25000000000000000000",
      tokensOut: "107142857142857142",
      quotedShares: "1071428571428571420",
      minShares: "1060714285714285705",
      multiplier: "10000000000000000000",
      isRequote: false,
    });

    // Verify simulation payload: ready plan has simulation evidence
    expect(recordedEvents[2]?.payload).toMatchObject({
      stage: "simulation",
      intentId,
      attempt: 1,
      available: true,
      ethCall: "ok",
      binance: "ok",
      gasEstimate: "450000",
      gasLimit: "562500",
      missingReason: null,
    });

    // 2. Confirm trade
    await act(async () => {
      await harness.getFlow().confirm();
    });

    expect(harness.getFlow().phase.name).toBe("done");

    // All 5 stages in order: intent -> quote -> simulation -> signed -> realized
    expect(recordedEvents.map((e) => e.stage)).toEqual([
      "intent",
      "quote",
      "simulation",
      "signed",
      "realized",
    ]);

    // Verify signed payload: contains txHash only, no signature material
    expect(recordedEvents[3]?.payload).toEqual({
      stage: "signed",
      intentId,
      attempt: 1,
      timestamp: expect.any(Number),
      txHash: sampleSuccessReceipt.txHash,
      isResumed: false,
      ticker: "NVDA",
      symbol: "NVDAB",
    });

    // Verify realized payload: fill details preserved
    expect(recordedEvents[4]?.payload).toMatchObject({
      stage: "realized",
      intentId,
      attempt: 1,
      txHash: sampleSuccessReceipt.txHash,
      status: "success",
      isResumed: false,
      blockNumber: 42000001,
      gasUsed: 448000,
      fill: {
        shares: "1071428571428571420",
        tokensOut: "107142857142857142",
        multiplier: "10000000000000000000",
        amountInUsdt: "25000000000000000000",
      },
    });

    harness.unmount();
  });

  it("handles approval flow with honest missing simulation evidence and subsequent re-quote correlation", async () => {
    const recordedEvents: RecordedEvent[] = [];

    const approvalPlan: PlanDto = getReadyPlan({
      status: "needs_approval",
      approve: {
        to: "0x55d398326f99059fF775485246999027B3197955",
        data: "0x095ea7b3...",
        amount: "25000000000000000000",
      },
      simulation: undefined,
    });

    let planCallCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/trade/plan") {
        planCallCount++;
        if (planCallCount === 1) {
          return { ok: true, json: async () => approvalPlan };
        }
        return { ok: true, json: async () => getReadyPlan() };
      }
      if (url.includes("/api/trade/receipt")) {
        return { ok: true, json: async () => sampleSuccessReceipt };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const harness = setupTestHook({
      onStage: (stage, payload) => {
        recordedEvents.push({ stage, payload });
      },
    });

    await act(async () => {
      harness.getFlow().start(defaultParams);
    });

    // Plan 1 needed approval: signed approve, mined, re-entered run() for Plan 2
    expect(planCallCount).toBe(2);
    expect(harness.getFlow().phase.name).toBe("review");

    const intentId = recordedEvents[0]?.payload.intentId;

    // Check events emitted so far:
    // 1. intent (attempt 1)
    // 2. quote (attempt 1)
    // 3. simulation (attempt 1, available: false, honest missingReason)
    // 4. quote (attempt 2, isRequote: true)
    // 5. simulation (attempt 2, available: true)
    expect(recordedEvents.map((e) => `${e.stage}:${e.payload.attempt}`)).toEqual([
      "intent:1",
      "quote:1",
      "simulation:1",
      "quote:2",
      "simulation:2",
    ]);

    expect(recordedEvents[2]?.payload).toEqual({
      stage: "simulation",
      intentId,
      attempt: 1,
      timestamp: expect.any(Number),
      available: false,
      missingReason: "Simulation deferred: token allowance approval required",
    });

    expect(recordedEvents[3]?.payload).toMatchObject({
      stage: "quote",
      intentId,
      attempt: 2,
      isRequote: true,
    });

    expect(recordedEvents[4]?.payload).toMatchObject({
      stage: "simulation",
      intentId,
      attempt: 2,
      available: true,
      missingReason: null,
    });

    harness.unmount();
  });

  it("handles re-quote on confirm when quote has expired", async () => {
    const recordedEvents: RecordedEvent[] = [];

    // Expired plan
    const expiredPlan: PlanDto = getReadyPlan({
      expiresAt: Date.now() - 1000,
    });
    const freshPlan: PlanDto = getReadyPlan({
      builtAt: Date.now(),
      expiresAt: Date.now() + 60000,
      minShares: "1060714285714285700",
    });

    let fetchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/trade/plan") {
        fetchCount++;
        return { ok: true, json: async () => (fetchCount === 1 ? expiredPlan : freshPlan) };
      }
      if (url.includes("/api/trade/receipt")) {
        return { ok: true, json: async () => sampleSuccessReceipt };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const harness = setupTestHook({
      onStage: (stage, payload) => {
        recordedEvents.push({ stage, payload });
      },
    });

    await act(async () => {
      harness.getFlow().start(defaultParams);
    });

    expect(harness.getFlow().phase.name).toBe("review");

    await act(async () => {
      await harness.getFlow().confirm();
    });

    expect(harness.getFlow().phase.name).toBe("done");

    // Events should include:
    // intent:1, quote:1, sim:1, quote:2 (isRequote), sim:2, signed:2, realized:2
    expect(recordedEvents.map((e) => `${e.stage}:${e.payload.attempt}`)).toEqual([
      "intent:1",
      "quote:1",
      "simulation:1",
      "quote:2",
      "simulation:2",
      "signed:2",
      "realized:2",
    ]);

    expect(recordedEvents[3]?.payload).toMatchObject({ isRequote: true });

    harness.unmount();
  });

  it("handles resumed pending transactions from storage with isResumed: true", async () => {
    const recordedEvents: RecordedEvent[] = [];

    const pendingTxHash = "0x9999888877776666555544443333222211110000999988887777666655554444";
    storage.set(
      "tally.pendingTx",
      JSON.stringify({
        hash: pendingTxHash,
        ticker: "NVDA",
        symbol: "NVDAB",
        at: Date.now() - 5000,
        intentId: "intent-resumed-stored",
        attempt: 3,
      }),
    );

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/trade/receipt")) {
        return {
          ok: true,
          json: async () => ({
            ...sampleSuccessReceipt,
            txHash: pendingTxHash,
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const harness = setupTestHook({
      onStage: (stage, payload) => {
        recordedEvents.push({ stage, payload });
      },
    });

    // Mount hook triggers pending effect
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(harness.getFlow().phase.name).toBe("done");

    expect(recordedEvents.map((e) => e.stage)).toEqual(["signed", "realized"]);

    expect(recordedEvents[0]?.payload).toEqual({
      stage: "signed",
      intentId: "intent-resumed-stored",
      attempt: 3,
      timestamp: expect.any(Number),
      txHash: pendingTxHash,
      isResumed: true,
      ticker: "NVDA",
      symbol: "NVDAB",
    });

    expect(recordedEvents[1]?.payload).toMatchObject({
      stage: "realized",
      intentId: "intent-resumed-stored",
      attempt: 3,
      txHash: pendingTxHash,
      status: "success",
      isResumed: true,
    });

    // Pending storage cleared on receipt
    expect(storage.get("tally.pendingTx")).toBeUndefined();

    harness.unmount();
  });

  it("proves failing subscriber warns and does NOT disrupt buy flow execution", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/trade/plan") return { ok: true, json: async () => getReadyPlan() };
      if (url.includes("/api/trade/receipt"))
        return { ok: true, json: async () => sampleSuccessReceipt };
      return { ok: false, status: 404, json: async () => ({}) };
    });

    // Subscriber throws on every single stage
    const failingSubscriber = vi.fn(() => {
      throw new Error("Subscriber internal failure");
    });

    const harness = setupTestHook({
      onStage: failingSubscriber,
    });

    await act(async () => {
      harness.getFlow().start(defaultParams);
    });

    expect(harness.getFlow().phase.name).toBe("review");

    await act(async () => {
      await harness.getFlow().confirm();
    });

    // Buy succeeds completely despite subscriber throwing on all stages
    expect(harness.getFlow().phase.name).toBe("done");
    expect(failingSubscriber).toHaveBeenCalledTimes(5);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[TradeStages] subscriber threw on stage"),
      expect.any(Error),
    );

    harness.unmount();
  });

  it("proves absence of subscriber leaves existing trade flow behavior fully intact", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/trade/plan") return { ok: true, json: async () => getReadyPlan() };
      if (url.includes("/api/trade/receipt"))
        return { ok: true, json: async () => sampleSuccessReceipt };
      return { ok: false, status: 404, json: async () => ({}) };
    });

    // Zero options / no subscriber
    const harness = setupTestHook();

    await act(async () => {
      harness.getFlow().start(defaultParams);
    });

    expect(harness.getFlow().phase.name).toBe("review");

    await act(async () => {
      await harness.getFlow().confirm();
    });

    expect(harness.getFlow().phase.name).toBe("done");

    harness.unmount();
  });

  it("WO-02 can consume global subscription without modifying trade-flow hook options", async () => {
    const globalEvents: Array<{ stage: TradeStage; intentId: string }> = [];

    // Simulate WO-02 slice B subscribing via subscribeTradeStage
    const unsubscribe = subscribeTradeStage((stage, payload) => {
      globalEvents.push({ stage, intentId: payload.intentId });
    });

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/trade/plan") return { ok: true, json: async () => getReadyPlan() };
      if (url.includes("/api/trade/receipt"))
        return { ok: true, json: async () => sampleSuccessReceipt };
      return { ok: false, status: 404, json: async () => ({}) };
    });

    // Flow instantiated without options (exactly like current trade-client.tsx)
    const harness = setupTestHook();

    await act(async () => {
      harness.getFlow().start(defaultParams);
    });

    await act(async () => {
      await harness.getFlow().confirm();
    });

    expect(globalEvents.map((e) => e.stage)).toEqual([
      "intent",
      "quote",
      "simulation",
      "signed",
      "realized",
    ]);

    unsubscribe();
    harness.unmount();
  });

  it("proves pending tx is persisted to storage BEFORE signed stage event is emitted", async () => {
    let pendingInStorageWhenSignedEmitted: string | null = null;
    const hash = sampleSuccessReceipt.txHash;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/trade/plan") return { ok: true, json: async () => getReadyPlan() };
      if (url.includes("/api/trade/receipt"))
        return { ok: true, json: async () => sampleSuccessReceipt };
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const harness = setupTestHook({
      onStage: (stage) => {
        if (stage === "signed") {
          // Verify that at the exact instant 'signed' is emitted, storage already has the pending tx
          pendingInStorageWhenSignedEmitted = storage.get("tally.pendingTx") ?? null;
        }
      },
    });

    await act(async () => {
      harness.getFlow().start(defaultParams);
    });

    await act(async () => {
      await harness.getFlow().confirm();
    });

    expect(pendingInStorageWhenSignedEmitted).not.toBeNull();
    const parsed = JSON.parse(pendingInStorageWhenSignedEmitted!) as {
      hash: string;
      ticker: string;
    };
    expect(parsed.hash).toBe(hash);
    expect(parsed.ticker).toBe("NVDA");

    harness.unmount();
  });

  it("proves a late subscriber with replay: true receives resumed signed and realized events emitted on mount", async () => {
    const pendingTxHash =
      "0xfeed00001111222233334444555566667777888899990000aaaabbbbcccc0002" as const;
    storage.set(
      "tally.pendingTx",
      JSON.stringify({
        hash: pendingTxHash,
        ticker: "NVDA",
        symbol: "NVDAB",
        at: Date.now() - 5000,
        intentId: "intent-late-resumed",
        attempt: 2,
      }),
    );

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/trade/receipt")) {
        return {
          ok: true,
          json: async () => ({
            ...sampleSuccessReceipt,
            txHash: pendingTxHash,
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    // Mount hook with NO subscriber - simulates child component rendering before parent subscriber registers
    const harness = setupTestHook();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(harness.getFlow().phase.name).toBe("done");

    // Late subscriber registers AFTER the resumed events have already fired on mount
    const lateEvents: RecordedEvent[] = [];
    const unsubscribe = subscribeTradeStage(
      (stage, payload) => {
        lateEvents.push({ stage, payload });
      },
      { replay: true },
    );

    expect(lateEvents.map((e) => e.stage)).toEqual(["signed", "realized"]);
    expect(lateEvents[0]?.payload).toMatchObject({
      stage: "signed",
      intentId: "intent-late-resumed",
      attempt: 2,
      txHash: pendingTxHash,
      isResumed: true,
    });
    expect(lateEvents[1]?.payload).toMatchObject({
      stage: "realized",
      intentId: "intent-late-resumed",
      attempt: 2,
      txHash: pendingTxHash,
      status: "success",
      isResumed: true,
    });

    unsubscribe();
    harness.unmount();
  });

  it("proves a late subscriber with default/replay: false does NOT receive past resumed events", async () => {
    const pendingTxHash =
      "0xfeed00001111222233334444555566667777888899990000aaaabbbbcccc0003" as const;
    storage.set(
      "tally.pendingTx",
      JSON.stringify({
        hash: pendingTxHash,
        ticker: "NVDA",
        symbol: "NVDAB",
        at: Date.now() - 5000,
        intentId: "intent-late-resumed-default",
        attempt: 1,
      }),
    );

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/trade/receipt")) {
        return {
          ok: true,
          json: async () => ({
            ...sampleSuccessReceipt,
            txHash: pendingTxHash,
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const harness = setupTestHook();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(harness.getFlow().phase.name).toBe("done");

    const lateEvents: RecordedEvent[] = [];
    const unsubscribe = subscribeTradeStage((stage, payload) => {
      lateEvents.push({ stage, payload });
    });

    expect(lateEvents).toHaveLength(0);

    unsubscribe();
    harness.unmount();
  });
});
