"use client";
import { useEffect } from "react";
import { useTallyWallet } from "../../components/wallet/wallet-context";
import {
  subscribeTradeStage,
  type TradeStageListener,
  type IntentStagePayload,
  type QuoteStagePayload,
  type SimulationStagePayload,
  type SignedStagePayload,
} from "../../components/trade/trade-stages";
import { parseReceiptHint, type ReceiptHint } from "@tally/mod-receipts";
interface Attempt {
  intent?: IntentStagePayload;
  quote?: QuoteStagePayload;
  simulation?: SimulationStagePayload;
  signed?: SignedStagePayload;
  resumedUser?: string;
}
interface RecorderOptions {
  subscribe?: typeof subscribeTradeStage;
  fetch?: typeof fetch;
  user?: string;
  onWarn?: (message: string) => void;
}
/** Replay and live delivery share the same bounded accumulator. Realized amounts never leave this recorder. */
export function startReceiptRecorder(options: RecorderOptions = {}): () => void {
  const attempts = new Map<string, Attempt>();
  const intents = new Map<string, IntentStagePayload>();
  const sent = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const controller = new AbortController();
  const warn = options.onWarn ?? console.warn;
  function bounded<T>(map: Map<string, T>, key: string, value: T) {
    map.set(key, value);
    if (map.size > 50) map.delete(map.keys().next().value!);
  }
  async function post(hint: ReceiptHint, retry = 0): Promise<void> {
    if (controller.signal.aborted) return;
    try {
      const result = await (options.fetch ?? fetch)("/api/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(hint),
        signal: controller.signal,
      });
      if (result.ok || result.status === 404) return;
      if (result.status < 500 && result.status !== 429) {
        warn("Receipt hint rejected; trade continues independently");
        return;
      }
    } catch {
      if (controller.signal.aborted) return;
    }
    warn("Receipt hint delivery unavailable; trade continues independently");
    if (retry < 2) {
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          void post(hint, retry + 1);
        },
        (retry + 1) * 2000,
      );
      timers.add(timer);
    }
  }
  function flush(a: Attempt) {
    const s = a.signed;
    if (!s) return;
    const key = `${s.txHash}:${s.intentId}`;
    if (sent.has(key)) return;
    const q = a.quote?.attempt === s.attempt ? a.quote : undefined;
    const sim = a.simulation?.attempt === s.attempt ? a.simulation : undefined;
    const hint = parseReceiptHint({
      version: 1,
      txHash: s.txHash,
      intentId: s.intentId,
      attempt: s.attempt,
      user: a.intent?.user ?? options.user ?? a.resumedUser,
      ticker: a.intent?.ticker ?? s.ticker,
      isResumed: s.isResumed,
      quote: q
        ? {
            stock: q.stock,
            issuer: q.issuer,
            tokensOut: q.tokensOut,
            multiplier: q.multiplier,
            minShares: q.minShares,
            amountInUsdt: q.amountInUsdt,
            hops: q.hops,
            routeText: q.routeText,
            builtAt: q.builtAt,
            expiresAt: q.expiresAt,
          }
        : null,
      simulation: sim ? { available: sim.available, missingReason: sim.missingReason } : null,
    });
    if (!hint) return;
    sent.add(key);
    if (sent.size > 100) sent.delete(sent.values().next().value!);
    void post(hint);
  }
  const listener: TradeStageListener = (_stage, payload) => {
    const key = `${payload.intentId}:${payload.attempt}`;
    const a = attempts.get(key) ?? { intent: intents.get(payload.intentId) };
    switch (payload.stage) {
      case "intent":
        bounded(intents, payload.intentId, payload);
        a.intent = payload;
        break;
      case "quote":
        if (!a.signed) a.quote = payload;
        break;
      case "simulation":
        if (!a.signed) a.simulation = payload;
        break;
      case "signed":
        a.signed = payload;
        break;
      case "realized":
        // A resumed success can recover its user hint from WO-01. The server still verifies sender.
        a.resumedUser = payload.fill?.user;
        a.signed ??= {
          stage: "signed",
          intentId: payload.intentId,
          attempt: payload.attempt,
          timestamp: payload.timestamp,
          txHash: payload.txHash,
          isResumed: payload.isResumed,
        };
        break;
    }
    bounded(attempts, key, a);
    flush(a);
  };
  const unsubscribe = (options.subscribe ?? subscribeTradeStage)(listener, { replay: true });
  return () => {
    controller.abort();
    unsubscribe();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
}
/** WO-12 mounts this once inside WalletRoot, guarded by the server's FEATURE_RECEIPTS flag. */
export function ReceiptRecorder({ enabled = true }: { enabled?: boolean }) {
  const wallet = useTallyWallet();
  useEffect(
    () =>
      enabled
        ? startReceiptRecorder({ user: wallet.authenticated ? wallet.address : undefined })
        : undefined,
    [enabled, wallet.authenticated, wallet.address],
  );
  return null;
}
