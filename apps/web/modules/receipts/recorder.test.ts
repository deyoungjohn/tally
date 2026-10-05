import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startReceiptRecorder } from "./recorder";
import {
  clearTradeStageSubscribersForTests,
  dispatchTradeStage,
  getTradeStageSubscriberCount,
  type IntentStagePayload,
  type QuoteStagePayload,
  type SignedStagePayload,
} from "../../components/trade/trade-stages";
import { recordedHint } from "../../../../packages/mod-receipts/src/fixtures/ingestion";
const h = recordedHint();
const intent: IntentStagePayload = {
  stage: "intent",
  intentId: h.intentId,
  attempt: 1,
  timestamp: 0,
  ticker: h.ticker,
  issuer: "bstock",
  symbol: "NVDAB",
  usd: 6,
  tolerancePct: 1,
  user: h.user,
};
const quote: QuoteStagePayload = {
  stage: "quote",
  intentId: h.intentId,
  attempt: 1,
  timestamp: 1,
  ...h.quote!,
  ticker: "NVDA",
  symbol: "NVDAB",
  guard: "0x28f6f19bffbf25e36452c78d12090f0bc922970a",
  quotedShares: "25674701000000000",
  usdPerShare: 233.69,
  referencePrice: null,
  premium: null,
  vendor: "recorded",
  feedUpdate: false,
  isRequote: false,
  warnings: [],
};
const signed: SignedStagePayload = {
  stage: "signed",
  intentId: h.intentId,
  attempt: 1,
  timestamp: 2,
  txHash: h.txHash,
  isResumed: false,
  ticker: "NVDA",
  symbol: "NVDAB",
};
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal("window", {});
  clearTradeStageSubscribersForTests();
});
afterEach(() => {
  stop?.();
  stop = undefined;
  clearTradeStageSubscribersForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function stages() {
  dispatchTradeStage("intent", intent);
  dispatchTradeStage("quote", quote);
  dispatchTradeStage("signed", signed);
}
it("late mount replays all stages, posts once per hash/intent, and never posts realized browser amounts", async () => {
  stages();
  const send = vi.fn<typeof fetch>(async () => new Response("{}", { status: 202 }));
  stop = startReceiptRecorder({ fetch: send });
  dispatchTradeStage("signed", signed);
  dispatchTradeStage("realized", {
    stage: "realized",
    intentId: h.intentId,
    attempt: 1,
    timestamp: 3,
    txHash: h.txHash,
    status: "success",
    isResumed: false,
    gasUsed: 999999,
    fill: {
      user: h.user,
      stock: h.quote!.stock,
      tokensOut: "999",
      shares: "999",
      multiplier: "999",
      amountInUsdt: "999",
      usdPerShare: 999,
      referencePrice: null,
      premium: null,
    },
  });
  expect(send).toHaveBeenCalledTimes(1);
  const payload = JSON.parse(String(send.mock.calls[0]![1]!.body));
  expect(payload).toMatchObject({
    txHash: h.txHash,
    user: h.user,
    quote: { tokensOut: h.quote!.tokensOut },
  });
  expect(payload).not.toHaveProperty("realized");
  expect(payload).not.toHaveProperty("gasUsed");
  expect(getTradeStageSubscriberCount()).toBe(1);
  stop();
  expect(getTradeStageSubscriberCount()).toBe(0);
});
it("resumed signed event arrives from replay using the wallet user without inventing a quote or simulation", () => {
  dispatchTradeStage("signed", { ...signed, isResumed: true });
  const send = vi.fn<typeof fetch>(async () => new Response("{}", { status: 202 }));
  stop = startReceiptRecorder({ fetch: send, user: h.user });
  expect(JSON.parse(String(send.mock.calls[0]![1]!.body))).toMatchObject({
    isResumed: true,
    user: h.user,
    quote: null,
    simulation: null,
  });
});
it("a resumed success can recover the user hint, while chain verification stays server-side", () => {
  const send = vi.fn<typeof fetch>(async () => new Response("{}", { status: 202 }));
  stop = startReceiptRecorder({ fetch: send });
  dispatchTradeStage("signed", { ...signed, isResumed: true });
  expect(send).not.toHaveBeenCalled();
  dispatchTradeStage("realized", {
    stage: "realized",
    intentId: h.intentId,
    attempt: 1,
    timestamp: 3,
    txHash: h.txHash,
    status: "success",
    isResumed: true,
    fill: {
      user: h.user,
      stock: h.quote!.stock,
      tokensOut: "999",
      shares: "999",
      multiplier: "999",
      amountInUsdt: "999",
      usdPerShare: 999,
      referencePrice: null,
      premium: null,
    },
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(send.mock.calls[0]![1]!.body))).toMatchObject({
    user: h.user,
    quote: null,
  });
});
it("re-quote attempt keeps the intent user and records simulation validation without output amounts", () => {
  const send = vi.fn<typeof fetch>(async () => new Response("{}", { status: 202 }));
  stop = startReceiptRecorder({ fetch: send });
  dispatchTradeStage("intent", intent);
  dispatchTradeStage("quote", { ...quote, attempt: 2 });
  dispatchTradeStage("simulation", {
    stage: "simulation",
    intentId: h.intentId,
    attempt: 2,
    timestamp: 1,
    available: true,
    ethCall: "ok",
    binance: "ok",
    missingReason: null,
  });
  dispatchTradeStage("signed", { ...signed, attempt: 2 });
  expect(JSON.parse(String(send.mock.calls[0]![1]!.body))).toMatchObject({
    attempt: 2,
    user: h.user,
    quote: { tokensOut: h.quote!.tokensOut },
    simulation: { available: true, missingReason: null },
  });
});
it("delivery failures warn and retry within bounds; unmount cancels retries", async () => {
  vi.useFakeTimers();
  const warn = vi.fn();
  const send = vi.fn<typeof fetch>(async () => {
    throw new Error("unsafe transport details");
  });
  stop = startReceiptRecorder({ fetch: send, onWarn: warn });
  stages();
  await vi.advanceTimersByTimeAsync(2000);
  expect(send).toHaveBeenCalledTimes(2);
  stop();
  await vi.advanceTimersByTimeAsync(10000);
  expect(send).toHaveBeenCalledTimes(2);
  expect(warn.mock.calls.flat().join()).not.toContain("unsafe transport");
});
it("404 disables delivery retries without disturbing the trade event listener", async () => {
  vi.useFakeTimers();
  const send = vi.fn<typeof fetch>(async () => new Response("{}", { status: 404 }));
  stop = startReceiptRecorder({ fetch: send });
  stages();
  await vi.advanceTimersByTimeAsync(20000);
  expect(send).toHaveBeenCalledTimes(1);
});
