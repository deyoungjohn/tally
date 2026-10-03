"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import type { ApiError, PlanDto, ReceiptDto } from "@/lib/dto";
import { useTallyWallet } from "@/components/wallet/wallet-context";

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

export function useTradeFlow() {
  const wallet = useTallyWallet();
  const [phase, setPhase] = useState<FlowPhase>({ name: "idle" });
  const paramsRef = useRef<FlowParams | null>(null);
  const runId = useRef(0);
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

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
      const id = ++runId.current;
      setPhase({ name: "quoting" });
      try {
        const plan = await fetchPlan(p, w.address);
        if (id !== runId.current) return;
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
    [fail, waitReceipt],
  );

  const start = useCallback(
    (p: FlowParams) => {
      paramsRef.current = p;
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
      writePending({ hash, ticker: p.ticker, symbol: p.symbol, at: Date.now() }); // before polling: never lose the hash
      setPhase({ name: "swap", plan, step: "mining", txHash: hash });
      const r = await waitReceipt(hash, p, id);
      writePending(null);
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
  }, [phase, run, fail, waitReceipt]);

  const cancel = useCallback(() => {
    runId.current++;
    setPhase({ name: "idle" });
  }, []);

  // Resume a swap that was sent before a reload or a lost connection.
  useEffect(() => {
    const pending = readPending();
    if (!pending) return;
    const id = ++runId.current;
    setPhase({ name: "swap", step: "mining", txHash: pending.hash });
    void waitReceipt(
      pending.hash,
      { ticker: pending.ticker, symbol: pending.symbol } as FlowParams,
      id,
    )
      .then((r) => {
        writePending(null);
        if (r.status === "success" && r.fill) setPhase({ name: "done", receipt: r });
        else setPhase({ name: "idle" });
      })
      .catch(() => undefined);
  }, [waitReceipt]);

  return { phase, start, run, confirm, cancel, params: paramsRef };
}
