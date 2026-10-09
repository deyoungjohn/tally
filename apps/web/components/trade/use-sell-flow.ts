"use client";
// The sell flow (a separate hook; the buy hook is untouched). It plans through /api/trade/sell, approves the exact amount when
// asked, re-plans before signing, signs exactly the plan's transaction and watches it through /api/trade/tx-status.
// Sells emit no buy-shaped stage events. Once the sale's hash exists (never the approval's) one fire-and-forget receipt hint is posted
// through postSellReceiptHint (emitSellStage is not used, so there is exactly one POST per sale); it can never block or fail the sell.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import type { SellPlan } from "@tally/engine";
import { useTallyWallet } from "@/components/wallet/wallet-context";
import type { Address } from "@tally/core";
import { MIN_SELL_USDT } from "@tally/config";
import { createSellIntent, fetchSellPlan, postSellReceiptHint } from "../../lib/trade-plan/sell";
import type { SellIntent } from "../../lib/trade-plan/sell";
import { explainSellError, planGotWorse, type SellFailure } from "../../lib/sell/view";
import { ONDO_CLOSED_TIP } from "./ondo-gate";
import { notifyPortfolioChanged } from "../../lib/hooks/portfolio-changed";

/** The plain reason for a failed sale. Ondo tokens sell only while the US market is open: say that, not the router's wording. */
function explainFor(e: unknown, t: SellTarget | null): SellFailure {
  const f = explainSellError(e);
  if (t?.issuer === "ondo" && /signed order/i.test(f.message))
    return { ...f, message: ONDO_CLOSED_TIP };
  return f;
}

export interface SellTarget {
  ticker: string;
  issuer: "ondo" | "bstock";
  symbol: string;
  /** The holding's shares as the Portfolio shows them. Used only for the opening check, never signed. */
  probeShares: number;
  /** What that holding is worth in dollars, for the minimum-sale check before any request is made. Never signed. */
  probeUsd?: number | null;
}

export type SellPhase =
  | { name: "idle" }
  | { name: "loading" }
  | { name: "refused"; failure: SellFailure }
  | {
      name: "form";
      plan: SellPlan | null;
      refreshing: boolean;
      failure?: SellFailure;
      notice?: string;
    }
  | { name: "approve"; plan: SellPlan; step: "sign" | "mining" }
  | { name: "signing"; plan: SellPlan }
  | { name: "mining"; hash: string; slow: boolean }
  | {
      name: "confirmed";
      hash: string;
      blockNumber: number | null;
      gasUsed: number | null;
      /** What the gas cost in dollars, worked out from the plan's own fee estimate; null when that was not known. */
      feeUsd: number | null;
      /** The router-enforced least USDT of this sale (1e18 integer string), to set beside the verified amount. */
      floorUsdt: string | null;
      bscscan: string;
    }
  | { name: "failed"; failure: SellFailure; hash?: string; bscscan?: string };

export interface SellInputs {
  /** What the person typed, in shares. Ignored while `all` is set. */
  text: string;
  /** "Sell all": the plan is requested with the raw token balance the plan itself reported. */
  all: boolean;
  tolerancePct: number;
}

export const SELL_TOLERANCES = [0.5, 1, 2] as const;
const PENDING_KEY = "tally.pendingSell";
const APPROVE_GAS = 80_000n;
const POLL_MS = 3_000;
const TIMEOUT_MS = 180_000;
const SLOW_MS = 45_000;
const DEBOUNCE_MS = 450;
/** Quotes last 15 s; the sheet asks for a new one a second before, and never more often than this when a request fails. */
const AUTO_MIN_MS = 5_000;
const SHARES_RE = /^\d*\.?\d{0,8}$/;

/** What a resumed sale needs to post its receipt hint (bigints as decimal strings). */
interface PendingIntent {
  id: string;
  issuer: "ondo" | "bstock";
  stock: Address;
  user: Address;
  tokensIn: string;
  minUsdtOut: string;
  tolerancePct: number;
}
interface Pending {
  hash: string;
  ticker: string;
  symbol: string;
  at: number;
  wallet?: string;
  intent?: PendingIntent;
  /** The plan's fee estimate and the gas limit it was for, to turn the gas actually used into dollars. */
  fee?: { usd: number; limit: string };
}
const intentOf = (p: Pending): SellIntent | null => {
  const i = p.intent;
  if (!i) return null;
  try {
    return {
      ...createSellIntent(
        p.ticker,
        i.issuer,
        i.stock,
        i.user,
        BigInt(i.tokensIn),
        BigInt(i.minUsdtOut),
        i.tolerancePct,
      ),
      id: i.id,
    };
  } catch {
    return null;
  }
};
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
/** Gas actually used, in dollars: the plan's estimate was for the gas limit, so scale it. Null when either number is missing. */
export function feeInDollars(fee: Pending["fee"], gasUsed: number | undefined): number | null {
  if (!fee || gasUsed === undefined) return null;
  const limit = Number(fee.limit);
  if (!(limit > 0) || !Number.isFinite(fee.usd)) return null;
  return (fee.usd * gasUsed) / limit;
}
/** The wallet's exact raw balance of one token, from the holdings route (never from a displayed number). Null when it can't be read. */
async function readRawBalance(t: SellTarget, address: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/holdings?address=${address}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tokens?: { ticker: string; issuer: string; balanceRaw: string }[];
    };
    return (
      data.tokens?.find((x) => x.ticker === t.ticker && x.issuer === t.issuer)?.balanceRaw ?? null
    );
  } catch {
    return null;
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TxStatus {
  status: "pending" | "success" | "reverted";
  hash: string;
  blockNumber?: number;
  gasUsed?: number;
  bscscan: string;
}

/** Roughly what the sale is worth, from the holding's own value; null when that is unknown. The engine's check stays the authority. */
export function estimateSaleUsd(t: SellTarget, i: SellInputs): number | null {
  if (t.probeUsd === null || t.probeUsd === undefined || !(t.probeShares > 0)) return null;
  if (i.all) return t.probeUsd;
  const n = parseShares(i.text);
  return n === null ? null : (n / t.probeShares) * t.probeUsd;
}
export function isBelowMinimum(t: SellTarget, i: SellInputs): boolean {
  const v = estimateSaleUsd(t, i);
  return v !== null && v < MIN_SELL_USDT;
}

/** The share amount the form can request, or null when the text is not a positive amount. */
export function parseShares(text: string): number | null {
  if (!SHARES_RE.test(text) || text === "" || text === ".") return null;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function useSellFlow() {
  const wallet = useTallyWallet();
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const [phase, setPhaseState] = useState<SellPhase>({ name: "idle" });
  const setPhase = useCallback((next: SellPhase | ((cur: SellPhase) => SellPhase)) => {
    setPhaseState((cur) => {
      const v = typeof next === "function" ? next(cur) : next;
      phaseRef.current = v;
      return v;
    });
  }, []);
  const [target, setTarget] = useState<SellTarget | null>(null);
  const [inputs, setInputsState] = useState<SellInputs>({ text: "", all: false, tolerancePct: 1 });
  /** Counts input changes, so a plan is requested for what the person changed and not whenever the phase returns to the form. */
  const [version, setVersion] = useState(0);
  const phaseRef = useRef<SellPhase>({ name: "idle" });
  const runId = useRef(0);
  const targetRef = useRef<SellTarget | null>(null);
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  /** The raw token balance, exactly as the last plan reported it. Never rebuilt from a displayed number. */
  const rawBalance = useRef<string | null>(null);
  const lastPlan = useRef<SellPlan | null>(null);

  const requestFor = useCallback((t: SellTarget, i: SellInputs) => {
    // Below the minimum sale there is nothing to ask the server: the sheet says so and offers no way to confirm.
    if (isBelowMinimum(t, i)) return null;
    const base = { ticker: t.ticker, issuer: t.issuer, tolerancePct: i.tolerancePct };
    if (i.all) return rawBalance.current ? { ...base, tokens: rawBalance.current } : null;
    const shares = parseShares(i.text);
    return shares === null ? null : { ...base, shares };
  }, []);

  const plan = useCallback(
    async (t: SellTarget, i: SellInputs): Promise<SellPlan | null> => {
      const w = walletRef.current;
      if (!w.address) return null;
      const req = requestFor(t, i);
      if (!req) return null;
      const p = await fetchSellPlan({ ...req, user: w.address });
      rawBalance.current = p.balances.tokens;
      lastPlan.current = p;
      return p;
    },
    [requestFor],
  );

  const failAs = useCallback((e: unknown, id: number, keepForm = true) => {
    if (id !== runId.current) return;
    const failure = explainFor(e, targetRef.current);
    if (failure.kind === "refused" || failure.kind === "region")
      return setPhase({ name: "refused", failure });
    // The old plan was for different inputs: keeping it would leave a Confirm button on screen for a sale that was just refused.
    if (keepForm) setPhase({ name: "form", plan: null, refreshing: false, failure });
    else setPhase({ name: "failed", failure });
  }, []);

  /** Watches a transaction until it is mined (or the wait runs out). */
  const waitForTx = useCallback(
    async (hash: string, id: number, onSlow?: () => void): Promise<TxStatus> => {
      const t0 = Date.now();
      let slowSent = false;
      for (;;) {
        if (id !== runId.current)
          throw Object.assign(new Error("cancelled"), { kind: "cancelled" });
        try {
          const res = await fetch(`/api/trade/tx-status?hash=${hash}`, { cache: "no-store" });
          if (res.ok) {
            const s = (await res.json()) as TxStatus;
            if (s.status !== "pending") return s;
          }
        } catch {
          /* transient: keep polling, the hash is already saved */
        }
        const waited = Date.now() - t0;
        if (!slowSent && waited > SLOW_MS) {
          slowSent = true;
          onSlow?.();
        }
        if (waited > TIMEOUT_MS) throw Object.assign(new Error("timeout"), { kind: "timeout" });
        await sleep(POLL_MS);
      }
    },
    [],
  );

  const watch = useCallback(
    async (hash: string, id: number, fee?: Pending["fee"], floorUsdt?: string) => {
      setPhase({ name: "mining", hash, slow: false });
      try {
        const s = await waitForTx(hash, id, () =>
          setPhase((p) => (p.name === "mining" ? { ...p, slow: true } : p)),
        );
        if (id !== runId.current) return;
        writePending(null);
        if (s.status === "success")
          setPhase({
            name: "confirmed",
            hash,
            blockNumber: s.blockNumber ?? null,
            gasUsed: s.gasUsed ?? null,
            feeUsd: feeInDollars(fee, s.gasUsed),
            floorUsdt: floorUsdt ?? null,
            bscscan: s.bscscan,
          });
        else
          setPhase({
            name: "failed",
            hash,
            bscscan: s.bscscan,
            failure: {
              kind: "failed",
              message:
                "The sale didn't go through, so your tokens stayed put. Only the network fee was spent.",
            },
          });
      } catch (e) {
        if ((e as { kind?: string }).kind === "cancelled") return;
        setPhase({
          name: "mining",
          hash,
          slow: true,
        });
      }
    },
    [waitForTx],
  );

  const setInputs = useCallback((patch: Partial<SellInputs>) => {
    setInputsState((cur) => ({ ...cur, ...patch }));
    setVersion((v) => v + 1);
  }, []);

  /** Opens the sheet: one plan to learn whether the token can be sold at all, and its raw balance. */
  const open = useCallback(async (t: SellTarget, initialText?: string) => {
    const id = ++runId.current;
    targetRef.current = t;
    setTarget(t);
    rawBalance.current = null;
    lastPlan.current = null;
    setInputsState({ text: "", all: false, tolerancePct: 1 });
    setVersion(0);
    setPhase({ name: "loading" });
    const w = walletRef.current;
    if (!w.authenticated || !w.address) {
      setPhase({
        name: "failed",
        failure: { kind: "failed", message: "Sign in to sell." },
      });
      return;
    }
    try {
      const probe = Math.floor(t.probeShares * 1e8) / 1e8;
      const p = await fetchSellPlan({
        ticker: t.ticker,
        issuer: t.issuer,
        shares: probe > 0 ? probe : undefined,
        tokens: probe > 0 ? undefined : "1",
        tolerancePct: 1,
        user: w.address,
      });
      if (id !== runId.current) return;
      rawBalance.current = p.balances.tokens;
      setPhase({ name: "form", plan: null, refreshing: false });
      if (initialText) setInputs({ text: initialText, all: false });
    } catch (e) {
      if (id !== runId.current) return;
      const failure = explainFor(e, targetRef.current);
      // The opening check can fail for reasons about the amount (below the minimum, a tiny shortfall): those are not refusals.
      if (
        failure.kind === "refused" ||
        failure.kind === "region" ||
        failure.kind === "unavailable" ||
        failure.kind === "busy"
      )
        setPhase({ name: "refused", failure });
      else {
        // The check failed for a reason about the amount (for instance a small holding below the minimum). "Sell all" still needs the
        // exact balance, so it is read from the holdings route; the plan then says in words why the sale can't go ahead.
        rawBalance.current = await readRawBalance(t, w.address);
        if (id !== runId.current) return;
        // Whatever the check said stays on screen: a sale that is declined always shows why.
        setPhase({ name: "form", plan: null, refreshing: false, failure: explainFor(e, t) });
        if (initialText) setInputs({ text: initialText, all: false });
      }
    }
  }, []);

  const sellAll = useCallback(() => setInputs({ all: true, text: "" }), [setInputs]);

  // Re-plan (debounced) whenever the person changes the amount or the tolerance while the form is showing.
  useEffect(() => {
    if (version === 0 || phaseRef.current.name !== "form" || !targetRef.current) return;
    const t = targetRef.current;
    const req = requestFor(t, inputsRef.current);
    if (!req) {
      setPhase((p) => (p.name === "form" ? { name: "form", plan: null, refreshing: false } : p));
      return;
    }
    const id = ++runId.current;
    setPhase((p) => (p.name === "form" ? { name: "form", plan: p.plan, refreshing: true } : p));
    const timer = setTimeout(
      () => {
        plan(t, inputsRef.current)
          .then((p) => {
            if (id !== runId.current || !p) return;
            setPhase({ name: "form", plan: p, refreshing: false });
          })
          .catch((e) => failAs(e, id));
      },
      inputsRef.current.all ? 0 : DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [version, requestFor, plan, failAs, setPhase]);

  /** A new quote for the same inputs (the old one expired, or the person asked). */
  const refresh = useCallback(async () => {
    const t = targetRef.current;
    if (!t) return;
    const id = ++runId.current;
    setPhase((p) =>
      p.name === "form" ? { ...p, refreshing: true, failure: undefined, notice: undefined } : p,
    );
    try {
      const p = await plan(t, inputsRef.current);
      if (id !== runId.current) return;
      setPhase({ name: "form", plan: p, refreshing: false });
    } catch (e) {
      failAs(e, id);
    }
  }, [plan, failAs]);

  // Quotes refresh themselves for as long as the sheet is open: a person's job is to confirm, not to ask for a new quote.
  const [retry, setRetry] = useState(0);
  const formPlan = phase.name === "form" ? phase.plan : null;
  const formRefreshing = phase.name === "form" ? phase.refreshing : false;
  useEffect(() => {
    if (!formPlan || formRefreshing) return;
    const wait = Math.max(AUTO_MIN_MS, formPlan.expiresAt - Date.now() - 1_000);
    const timer = setTimeout(() => {
      const t = targetRef.current;
      if (!t) return;
      const id = runId.current;
      plan(t, inputsRef.current)
        .then((next) => {
          if (id !== runId.current || !next) return;
          setPhase((cur) =>
            cur.name === "form" && !cur.refreshing
              ? { ...cur, plan: next, failure: undefined }
              : cur,
          );
        })
        .catch(() => setRetry((n) => n + 1)); // keep showing the last quote and try again
    }, wait);
    return () => clearTimeout(timer);
  }, [formPlan, formRefreshing, retry, plan, setPhase]);

  /** Sends the plan's approval for the exact amount, waits for it to mine, then asks for a new plan. */
  const approve = useCallback(async () => {
    if (phase.name !== "form" || !phase.plan || phase.plan.status !== "needs_approval") return;
    const seen = phase.plan;
    const t = targetRef.current;
    const w = walletRef.current;
    if (!t || !w.address || !seen.approve) return;
    // Exactly what is being sold, never an unlimited allowance.
    if (seen.approve.amount !== seen.tokensIn) {
      setPhase({
        name: "form",
        plan: seen,
        refreshing: false,
        failure: {
          kind: "failed",
          message: "The approval didn't match the amount, so nothing was sent.",
        },
      });
      return;
    }
    const id = ++runId.current;
    try {
      setPhase({ name: "approve", plan: seen, step: "sign" });
      const hash = await w.sendTx({
        to: seen.approve.to,
        data: seen.approve.data as Hex,
        gas: APPROVE_GAS,
      });
      if (id !== runId.current) return;
      setPhase({ name: "approve", plan: seen, step: "mining" });
      const s = await waitForTx(hash, id);
      if (s.status !== "success") {
        setPhase({
          name: "form",
          plan: seen,
          refreshing: false,
          failure: { kind: "failed", message: "The approval didn't go through. Nothing was sold." },
        });
        return;
      }
      const next = await plan(t, inputsRef.current);
      if (id !== runId.current) return;
      setPhase({ name: "form", plan: next, refreshing: false });
    } catch (e) {
      if (id !== runId.current || (e as { kind?: string }).kind === "cancelled") return;
      if ((e as { kind?: string }).kind === "timeout") {
        setPhase({
          name: "form",
          plan: seen,
          refreshing: false,
          failure: {
            kind: "unavailable",
            message: "Still waiting for the approval to confirm. Try again in a minute.",
          },
        });
        return;
      }
      failAs(e, id);
    }
  }, [phase, plan, waitForTx, failAs]);

  /** Confirm: a fresh plan first (plans last 15 s); a worse floor or a different amount asks again; only the fresh plan is signed. */
  const confirm = useCallback(async () => {
    if (phase.name !== "form" || !phase.plan || phase.plan.status !== "ready") return;
    const seen = phase.plan;
    const t = targetRef.current;
    const w = walletRef.current;
    if (!t || !w.address) return;
    const id = ++runId.current;
    setPhase({ name: "form", plan: seen, refreshing: true });
    let fresh: SellPlan | null = null;
    try {
      fresh = await plan(t, inputsRef.current);
      if (id !== runId.current) return;
      if (!fresh) return;
      if (fresh.status !== "ready" || !fresh.tx) {
        setPhase({
          name: "form",
          plan: fresh,
          refreshing: false,
          notice: "The quote changed. Review the new numbers.",
        });
        return;
      }
      if (planGotWorse(seen, fresh)) {
        setPhase({
          name: "form",
          plan: fresh,
          refreshing: false,
          notice: "The quote changed. Review the new numbers.",
        });
        return;
      }
      if (fresh.tx.chainId !== 56 || fresh.tx.value !== "0x0") {
        setPhase({
          name: "form",
          plan: fresh,
          refreshing: false,
          failure: {
            kind: "failed",
            message: "The transaction didn't match what was expected, so nothing was sent.",
          },
        });
        return;
      }
      setPhase({ name: "signing", plan: fresh });
      // Exactly the plan's transaction: its target, its calldata, zero value and its own gas limit. The wallet reads its real chain and switches to BSC first.
      const hash = await w.sendTx({
        to: fresh.tx.to,
        data: fresh.tx.data as Hex,
        gas: BigInt(fresh.tx.gasLimit),
      });
      const intent = createSellIntent(
        t.ticker,
        t.issuer,
        fresh.stock,
        w.address,
        BigInt(fresh.tokensIn),
        BigInt(fresh.minUsdtOut),
        fresh.tolerancePct,
      );
      writePending({
        hash,
        ticker: t.ticker,
        symbol: t.symbol,
        at: Date.now(),
        wallet: w.address,
        intent: {
          id: intent.id,
          issuer: intent.issuer,
          stock: intent.stock,
          user: intent.user,
          tokensIn: fresh.tokensIn,
          minUsdtOut: fresh.minUsdtOut,
          tolerancePct: intent.tolerancePct,
        },
        fee:
          fresh.tx.feeUsd === null ? undefined : { usd: fresh.tx.feeUsd, limit: fresh.tx.gasLimit },
      }); // before polling and before the hint: never lose the hash
      postSellReceiptHint({ intent, txHash: hash as `0x${string}`, plan: fresh, attempt: 1 });
      await watch(
        hash,
        id,
        fresh.tx.feeUsd === null ? undefined : { usd: fresh.tx.feeUsd, limit: fresh.tx.gasLimit },
        fresh.minUsdtOut,
      );
    } catch (e) {
      if (id !== runId.current || (e as { kind?: string }).kind === "cancelled") return;
      const shown = fresh ?? seen;
      if ((e as { code?: number }).code === 4001) {
        setPhase({
          name: "form",
          plan: shown,
          refreshing: false,
          failure: { kind: "rejected", message: "You cancelled in your wallet. Nothing was sold." },
        });
        return;
      }
      failAs(e, id);
    }
  }, [phase, plan, watch, failAs]);

  const close = useCallback(() => {
    runId.current++;
    targetRef.current = null;
    rawBalance.current = null;
    lastPlan.current = null;
    setTarget(null);
    setPhase({ name: "idle" });
  }, []);

  // A sell that was sent before a reload keeps being watched (bound to the signed-in wallet).
  useEffect(() => {
    if (wallet.ready === false) return;
    const pending = readPending();
    if (!pending) return;
    const currentAddress = wallet.address?.toLowerCase();
    const pendingWallet = (pending.wallet ?? pending.intent?.user)?.toLowerCase();
    if (
      !wallet.authenticated ||
      !currentAddress ||
      (pendingWallet && pendingWallet !== currentAddress)
    ) {
      writePending(null);
      return;
    }
    const id = ++runId.current;
    setTarget({
      ticker: pending.ticker,
      issuer: pending.intent?.issuer ?? "bstock",
      symbol: pending.symbol,
      probeShares: 0,
    });
    const resumed = intentOf(pending);
    if (resumed)
      postSellReceiptHint({
        intent: resumed,
        txHash: pending.hash as `0x${string}`,
        attempt: 1,
        isResumed: true,
      });
    void watch(pending.hash, id, pending.fee, pending.intent?.minUsdtOut);
  }, [watch, wallet.ready, wallet.authenticated, wallet.address]);

  // A confirmed sale changes the wallet: Portfolio (holdings, activity, statement) reads again now.
  const sold = phase.name === "confirmed";
  useEffect(() => {
    if (sold) notifyPortfolioChanged();
  }, [sold]);

  const belowMinimum = target ? isBelowMinimum(target, inputs) : false;
  return {
    phase,
    target,
    inputs,
    setInputs,
    sellAll,
    open,
    refresh,
    approve,
    confirm,
    close,
    belowMinimum,
  };
}
