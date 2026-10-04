"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import type { ApiError, PlanDto, ReceiptDto } from "@/lib/dto";
import { useTallyWallet } from "@/components/wallet/wallet-context";
import {
  createIntentId,
  dispatchTradeStage,
  type TradeStage,
  type TradeStageListener,
  type TradeStagePayloadMap,
} from "./trade-stages";

export interface FlowParams {
  ticker: string;
  issuer: "ondo" | "bstock";
  symbol: string;
  usd: number;
  tolerancePct: number;
}

export type FlowPhase =
  | { name: "idle" }
  | { name: "signin" }
  | { name: "quoting" }
  | { name: "topup"; plan: PlanDto }
  | { name: "approve"; plan: PlanDto; step: "sign" | "mining" }
  | { name: "review"; plan: PlanDto; notice?: string }
  | { name: "swap"; plan?: PlanDto; step: "sign" | "mining"; txHash?: string }
  | { name: "done"; receipt: ReceiptDto; plan?: PlanDto }
  | { name: "error"; kind: string; message: string; txHash?: string };

export interface TradeFlowOptions {
  onStage?: TradeStageListener;
}

/** Island view and 4-segment progress for the phase (Quoting → Approve → Swap → Confirmed, DESIGN §3.2). */
export function progressOf(p: FlowPhase): { view: string | null; step: number } {
  switch (p.name) {
    case "quoting":
    case "topup":
      return { view: "quote", step: 1 };
    case "approve":
      return { view: "approve", step: 2 };
    case "review":
      return { view: "quote", step: 1 };
    case "swap":
      return { view: "swap", step: 3 };
    case "done":
      return { view: "done", step: 4 };
    default:
      return { view: null, step: 0 };
  }
}

const PENDING_KEY = "tally.pendingTx";
const APPROVE_GAS = 80_000n;
const RECEIPT_POLL_MS = 3_000;
const RECEIPT_TIMEOUT_MS = 180_000;
/** A new quote that moves the guaranteed minimum by more than this must be re-confirmed (DESIGN §3.3 rule 2). */
const REVIEW_DRIFT = 0.001;

interface Pending {
  hash: string;
  ticker: string;
  symbol: string;
  at: number;
  intentId?: string;
  attempt?: number;
}
const readPending = (): Pending | null => {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null") as Pending | null;
    return p && Date.now() - p.at < 30 * 60_000 ? p : null;
  } catch {
    return null;
  }
};
const writePending = (p: Pending | null) => {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage blocked: the flow still works, it just can't resume after a reload */
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchPlan(
  params: FlowParams,
  user: string,
  signal?: AbortSignal,
): Promise<PlanDto> {
  const res = await fetch("/api/trade/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticker: params.ticker,
      issuer: params.issuer,
      usd: params.usd,
      tolerancePct: params.tolerancePct,
      user,
    }),
    signal,
  });
  const body = (await res.json()) as PlanDto | ApiError;
  if (!res.ok)
    throw Object.assign(new Error((body as ApiError).error.message), {
      kind: (body as ApiError).error.kind,
    });
  return body as PlanDto;
}

export function useTradeFlow(options: TradeFlowOptions = {}) {
  const { onStage } = options;
  const onStageRef = useRef(onStage);
  onStageRef.current = onStage;

  const wallet = useTallyWallet();
  const [phase, setPhase] = useState<FlowPhase>({ name: "idle" });
  const paramsRef = useRef<FlowParams | null>(null);
  const runId = useRef(0);
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const intentIdRef = useRef<string | null>(null);
  const attemptRef = useRef(1);
  const intentEmittedRef = useRef<string | null>(null);

  const emit = useCallback(<S extends TradeStage>(stage: S, payload: TradeStagePayloadMap[S]) => {
    dispatchTradeStage(stage, payload, onStageRef.current);
  }, []);

  const fail = useCallback((e: unknown, fallback = "Something went wrong. Nothing was spent.") => {
    const k = (e as { kind?: string }).kind ?? "error";
    setPhase({
      name: "error",
      kind: k,
      message: e instanceof Error && e.message ? e.message : fallback,
    });
  }, []);

  const waitReceipt = useCallback(
    async (hash: string, p: FlowParams | null, id: number): Promise<ReceiptDto> => {
      const t0 = Date.now();
      for (;;) {
        if (id !== runId.current)
          throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
        try {
          const q = new URLSearchParams({ tx: hash });
          if (p) {
            q.set("ticker", p.ticker);
            q.set("symbol", p.symbol);
          }
          const res = await fetch(`/api/trade/receipt?${q}`, { cache: "no-store" });
          if (res.ok) {
            const r = (await res.json()) as ReceiptDto;
            if (r.status !== "pending") return r;
          }
        } catch {
          /* transient: keep polling, the hash is already saved */
        }
        if (Date.now() - t0 > RECEIPT_TIMEOUT_MS)
          throw Object.assign(
            new Error(
              "Still waiting for the network to confirm. Check the link; your hash is saved.",
            ),
            {
              kind: "timeout",
            },
          );
        await sleep(RECEIPT_POLL_MS);
      }
    },
    [],
  );

  /** Quote and decide the next step: top-up, approve, or review. Re-entrant: call it again after each step. */
  const run = useCallback(
    async (notice?: string) => {
      const p = paramsRef.current;
      const w = walletRef.current;
      if (!p) return;
      if (!w.authenticated || !w.address) {
        setPhase({ name: "signin" });
        return;
      }
      if (!intentIdRef.current) {
        intentIdRef.current = createIntentId();
        attemptRef.current = 1;
      }
      const intentId = intentIdRef.current;

      if (intentEmittedRef.current !== intentId) {
        intentEmittedRef.current = intentId;
        emit("intent", {
          stage: "intent",
          intentId,
          attempt: 1,
          timestamp: Date.now(),
          ticker: p.ticker,
          issuer: p.issuer,
          symbol: p.symbol,
          usd: p.usd,
          tolerancePct: p.tolerancePct,
          user: w.address,
        });
      }

      const id = ++runId.current;
      setPhase({ name: "quoting" });
      try {
        const plan = await fetchPlan(p, w.address);
        if (id !== runId.current) return;

        emit("quote", {
          stage: "quote",
          intentId,
          attempt: attemptRef.current,
          timestamp: Date.now(),
          ticker: plan.ticker,
          issuer: plan.issuer,
          symbol: plan.symbol,
          stock: plan.stock,
          guard: plan.guard,
          amountInUsdt: plan.amountInUsdt,
          tokensOut: plan.tokensOut,
          quotedShares: plan.quotedShares,
          minShares: plan.minShares,
          multiplier: plan.multiplier,
          usdPerShare: plan.usdPerShare,
          referencePrice: plan.referencePrice,
          premium: plan.premium,
          routeText: plan.routeText,
          hops: plan.hops,
          vendor: plan.vendor,
          feedUpdate: plan.feedUpdate,
          builtAt: plan.builtAt,
          expiresAt: plan.expiresAt,
          isRequote: attemptRef.current > 1,
          warnings: plan.warnings,
        });

        if (plan.status === "ready" && plan.simulation) {
          emit("simulation", {
            stage: "simulation",
            intentId,
            attempt: attemptRef.current,
            timestamp: Date.now(),
            available: true,
            ethCall: plan.simulation.ethCall,
            binance: plan.simulation.binance,
            binanceNote: plan.simulation.binanceNote,
            gasEstimate: plan.tx?.gasEstimate,
            gasLimit: plan.tx?.gasLimit,
            missingReason: null,
          });
        } else if (plan.status === "needs_approval") {
          emit("simulation", {
            stage: "simulation",
            intentId,
            attempt: attemptRef.current,
            timestamp: Date.now(),
            available: false,
            missingReason: "Simulation deferred: token allowance approval required",
          });
        } else if (plan.status === "needs_funds") {
          emit("simulation", {
            stage: "simulation",
            intentId,
            attempt: attemptRef.current,
            timestamp: Date.now(),
            available: false,
            missingReason: "Simulation deferred: insufficient balance for trade and gas",
          });
        } else {
          emit("simulation", {
            stage: "simulation",
            intentId,
            attempt: attemptRef.current,
            timestamp: Date.now(),
            available: false,
            missingReason: "Simulation details unavailable from plan",
          });
        }

        if (plan.status === "needs_funds") return setPhase({ name: "topup", plan });
        if (plan.status === "needs_approval") {
          setPhase({ name: "approve", plan, step: "sign" });
          const hash = await w.sendTx({
            to: plan.approve!.to as `0x${string}`,
            data: plan.approve!.data as Hex,
            gas: APPROVE_GAS,
          });
          if (id !== runId.current) return;
          setPhase({ name: "approve", plan, step: "mining" });
          const r = await waitReceipt(hash, null, id);
          if (r.status !== "success")
            throw Object.assign(new Error("The approval didn't go through. Nothing was spent."), {
              kind: "approve_failed",
            });
          attemptRef.current++;
          return void run();
        }
        setPhase({ name: "review", plan, notice });
      } catch (e) {
        if (id !== runId.current) return;
        if ((e as { kind?: string }).kind === "cancelled") return;
        if ((e as { code?: number }).code === 4001) {
          setPhase({
            name: "error",
            kind: "rejected",
            message: "You cancelled in your wallet. Nothing was spent.",
          });
          return;
        }
        fail(e);
      }
    },
    [fail, waitReceipt, emit],
  );

  const start = useCallback(
    (p: FlowParams) => {
      paramsRef.current = p;
      intentIdRef.current = createIntentId();
      attemptRef.current = 1;
      intentEmittedRef.current = null;
      void run();
    },
    [run],
  );

  // Signing in from the sheet continues the buy.
  useEffect(() => {
    if (phase.name === "signin" && wallet.authenticated && wallet.address) void run();
  }, [phase.name, wallet.authenticated, wallet.address, run]);

  /** Confirm in the review sheet. A stale quote (15 s) is re-quoted first; a moved minimum asks again (DESIGN §3.3). */
  const confirm = useCallback(async () => {
    if (phase.name !== "review") return;
    const p = paramsRef.current;
    const w = walletRef.current;
    if (!p || !w.address) return;
    const id = ++runId.current;
    let plan = phase.plan;
    try {
      if (Date.now() > plan.expiresAt) {
        const fresh = await fetchPlan(p, w.address);
        if (id !== runId.current) return;
        if (fresh.status !== "ready") return void run();
        attemptRef.current++;
        const currentAttempt = attemptRef.current;
        const currentIntentId = intentIdRef.current ?? createIntentId();
        emit("quote", {
          stage: "quote",
          intentId: currentIntentId,
          attempt: currentAttempt,
          timestamp: Date.now(),
          ticker: fresh.ticker,
          issuer: fresh.issuer,
          symbol: fresh.symbol,
          stock: fresh.stock,
          guard: fresh.guard,
          amountInUsdt: fresh.amountInUsdt,
          tokensOut: fresh.tokensOut,
          quotedShares: fresh.quotedShares,
          minShares: fresh.minShares,
          multiplier: fresh.multiplier,
          usdPerShare: fresh.usdPerShare,
          referencePrice: fresh.referencePrice,
          premium: fresh.premium,
          routeText: fresh.routeText,
          hops: fresh.hops,
          vendor: fresh.vendor,
          feedUpdate: fresh.feedUpdate,
          builtAt: fresh.builtAt,
          expiresAt: fresh.expiresAt,
          isRequote: true,
          warnings: fresh.warnings,
        });
        if (fresh.simulation) {
          emit("simulation", {
            stage: "simulation",
            intentId: currentIntentId,
            attempt: currentAttempt,
            timestamp: Date.now(),
            available: true,
            ethCall: fresh.simulation.ethCall,
            binance: fresh.simulation.binance,
            binanceNote: fresh.simulation.binanceNote,
            gasEstimate: fresh.tx?.gasEstimate,
            gasLimit: fresh.tx?.gasLimit,
            missingReason: null,
          });
        }
        const drift = Math.abs(
          Number(BigInt(fresh.minShares) - BigInt(plan.minShares)) / Number(BigInt(plan.minShares)),
        );
        if (drift > REVIEW_DRIFT) {
          setPhase({
            name: "review",
            plan: fresh,
            notice: "The price changed a little. Review the new quote.",
          });
          return;
        }
        plan = fresh;
      }
      setPhase({ name: "swap", plan, step: "sign" });
      const hash = await w.sendTx({
        to: plan.tx!.to as `0x${string}`,
        data: plan.tx!.data as Hex,
        gas: BigInt(plan.tx!.gasLimit),
      });
      const currentIntentId = intentIdRef.current ?? createIntentId();
      const currentAttempt = attemptRef.current;
      emit("signed", {
        stage: "signed",
        intentId: currentIntentId,
        attempt: currentAttempt,
        timestamp: Date.now(),
        txHash: hash,
        isResumed: false,
        ticker: p.ticker,
        symbol: p.symbol,
      });
      writePending({
        hash,
        ticker: p.ticker,
        symbol: p.symbol,
        at: Date.now(),
        intentId: currentIntentId,
        attempt: currentAttempt,
      }); // before polling: never lose the hash
      setPhase({ name: "swap", plan, step: "mining", txHash: hash });
      const r = await waitReceipt(hash, p, id);
      writePending(null);
      emit("realized", {
        stage: "realized",
        intentId: currentIntentId,
        attempt: currentAttempt,
        timestamp: Date.now(),
        txHash: hash,
        status: r.status,
        isResumed: false,
        blockNumber: r.blockNumber,
        gasUsed: r.gasUsed,
        gasUsd: r.gasUsd,
        bscscan: r.bscscan,
        warning: r.warning,
        fill: r.fill,
      });
      if (r.status === "success" && r.fill) setPhase({ name: "done", receipt: r, plan });
      else if (r.status === "success")
        setPhase({
          name: "error",
          kind: "no_event",
          message: r.warning ?? "The transaction succeeded but we couldn't read the receipt.",
          txHash: hash,
        });
      else
        setPhase({
          name: "error",
          kind: "reverted",
          message:
            "The trade didn't go through, so you got nothing and only paid the small network fee.",
          txHash: hash,
        });
    } catch (e) {
      if (id !== runId.current || (e as { kind?: string }).kind === "cancelled") return;
      if ((e as { code?: number }).code === 4001) {
        setPhase({
          name: "review",
          plan,
          notice: "You cancelled in your wallet. Nothing was spent.",
        });
        return;
      }
      fail(e);
    }
  }, [phase, run, fail, waitReceipt, emit]);

  const cancel = useCallback(() => {
    runId.current++;
    intentIdRef.current = null;
    attemptRef.current = 1;
    intentEmittedRef.current = null;
    setPhase({ name: "idle" });
  }, []);

  // Resume a swap that was sent before a reload or a lost connection.
  useEffect(() => {
    const pending = readPending();
    if (!pending) return;
    const id = ++runId.current;
    const intentId = pending.intentId ?? `resumed-${pending.hash.slice(0, 10)}`;
    const attempt = pending.attempt ?? 1;
    intentIdRef.current = intentId;
    attemptRef.current = attempt;
    emit("signed", {
      stage: "signed",
      intentId,
      attempt,
      timestamp: pending.at,
      txHash: pending.hash,
      isResumed: true,
      ticker: pending.ticker,
      symbol: pending.symbol,
    });
    setPhase({ name: "swap", step: "mining", txHash: pending.hash });
    void waitReceipt(
      pending.hash,
      { ticker: pending.ticker, symbol: pending.symbol } as FlowParams,
      id,
    )
      .then((r) => {
        writePending(null);
        emit("realized", {
          stage: "realized",
          intentId,
          attempt,
          timestamp: Date.now(),
          txHash: pending.hash,
          status: r.status,
          isResumed: true,
          blockNumber: r.blockNumber,
          gasUsed: r.gasUsed,
          gasUsd: r.gasUsd,
          bscscan: r.bscscan,
          warning: r.warning,
          fill: r.fill,
        });
        if (r.status === "success" && r.fill) setPhase({ name: "done", receipt: r });
        else setPhase({ name: "idle" });
      })
      .catch(() => undefined);
  }, [waitReceipt, emit]);

  return { phase, start, run, confirm, cancel, params: paramsRef };
}
