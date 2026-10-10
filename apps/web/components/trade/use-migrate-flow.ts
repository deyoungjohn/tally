"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSellFlow, PENDING_SELL_KEY, type SellTarget } from "./use-sell-flow";
import type { PlanDto } from "@/lib/dto";
import {
  type PendingMigrate,
  readPendingMigrate,
  writePendingMigrate,
  clearPendingMigrate,
} from "../../lib/migrate/state";
import { fetchSaleStatus } from "../../lib/migrate/poll";

import { useTallyWallet } from "@/components/wallet/wallet-context";
import { useModuleFlags } from "@/lib/hooks/use-flags";

/** What the review dialog shows before anything is sent. */
export interface MigrateReview {
  target: SellTarget;
  to: "ondo" | "bstock";
}

export type MigrateStep = 1 | 2 | "interstitial" | "done" | "idle";

export function useMigrateFlow() {
  const flags = useModuleFlags();
  const flagsRef = useRef(flags.receipts);
  useEffect(() => {
    flagsRef.current = flags.receipts;
  }, [flags.receipts]);

  const sell = useSellFlow();
  const wallet = useTallyWallet();
  const [pm, setPm] = useState<PendingMigrate | null>(null);
  const [step, setStep] = useState<MigrateStep>("idle");
  const [waitingReceipt, setWaitingReceipt] = useState(false);
  const [source, setSource] = useState<"receipt" | "wallet" | "chain" | null>(null);
  // Migrate starts with a review dialog (what you sell, what you receive, the costs). Confirming it sells the whole holding by
  // itself: "auto" drives the sell flow's own steps (sell all, approve, sign) so nobody has to click through its form.
  const [reviewing, setReviewing] = useState<MigrateReview | null>(null);
  const [auto, setAuto] = useState(false);
  const acted = useRef("");
  const [receiptState, setReceiptState] = useState<
    "pending" | "failed" | "unreconciled" | "underMinimum" | null
  >(null);
  const terminalStateRef = useRef(false);
  const [waitElapsedMs, setWaitElapsedMs] = useState(0);

  useEffect(() => {
    if (!wallet.address) return;
    if (pm) {
      if (pm.wallet && pm.wallet.toLowerCase() !== wallet.address.toLowerCase()) {
        terminalStateRef.current = false;
        setPm(null);
        setStep("idle");
      }
      return;
    }
    const saved = readPendingMigrate(wallet.address);
    // A Migrate whose buy is already sent is finished: it is never reopened by a page change or a reload. Its receipt stays
    // reachable from the Statement and the receipt links.
    if (saved && saved.step === 2 && saved.buyHash) {
      clearPendingMigrate();
      return;
    }
    if (saved) {
      setPm(saved);
      if (saved.source) setSource(saved.source);
      if (saved.step === 1) {
        if (saved.saleHash) {
          setStep("interstitial");
          if (!saved.usdtReceived) {
            setWaitingReceipt(true);
            setReceiptState("pending");
          }
        } else {
          setStep(1);
        }
      } else if (saved.step === 2) {
        if (saved.buyHash) {
          setStep("done");
        } else {
          setStep("interstitial");
        }
      }
    }
  }, [wallet.address, pm]);

  const begin = useCallback(
    async (target: SellTarget, toIssuer: "ondo" | "bstock") => {
      let usdtBefore = "0";
      if (wallet.address) {
        try {
          const res = await fetch(`/api/portfolio?address=${wallet.address}`);
          if (res.ok) {
            const data = await res.json();
            usdtBefore = data.wallet?.usdt?.toString() ?? "0";
          }
        } catch {
          // ignore
        }
      }

      const newPm: PendingMigrate = {
        id: "mig-" + Date.now(),
        wallet: wallet.address,
        ticker: target.ticker,
        from: target.issuer,
        to: toIssuer,
        step: 1,
        usdtBefore,
        createdAt: Date.now(),
      };
      writePendingMigrate(newPm);
      setPm(newPm);
      setStep(1);
      sell.open(target);
    },
    [sell, wallet.address],
  );

  /** Migrate was pressed: show the review first. Nothing is sent until it is confirmed. */
  const open = useCallback((target: SellTarget, to: "ondo" | "bstock") => {
    setReviewing({ target, to });
  }, []);
  const cancelReview = useCallback(() => setReviewing(null), []);
  // Leaving a Migrate that is under way asks first (the sheet shows the question); "Keep going" restarts whatever was open.
  const [dropAsk, setDropAsk] = useState(false);
  const [restartKey, setRestartKey] = useState(0);
  const askDrop = useCallback(() => setDropAsk(true), []);
  const keepGoing = useCallback(() => {
    setDropAsk(false);
    setRestartKey((k) => k + 1);
  }, []);
  const confirmReview = useCallback(async () => {
    if (!reviewing) return;
    const r = reviewing;
    setReviewing(null);
    acted.current = "";
    setAuto(true);
    await begin(r.target, r.to);
  }, [reviewing, begin]);

  const cancel = useCallback(() => {
    terminalStateRef.current = false;
    setAuto(false);
    setReviewing(null);
    clearPendingMigrate();
    setPm(null);
    setStep("idle");
    setWaitingReceipt(false);
    setReceiptState(null);
    setWaitElapsedMs(0);
    sell.close();
    // The sale's own saved watch must go too, or the sell sheet brings the dropped Migrate back after a reload.
    try {
      localStorage.removeItem(PENDING_SELL_KEY);
    } catch {
      /* storage blocked: nothing to remove */
    }
  }, [sell]);
  const drop = useCallback(() => {
    setDropAsk(false);
    cancel();
  }, [cancel]);

  // The automatic sale: sell all, approve if the plan asks for it, then sign. Each plan is acted on once; if anything
  // comes back needing a person (a refusal, a worse price, a failure) the automation stops and the sell sheet takes over.
  const { phase: sp, inputs: sellInputs, sellAll, approve, confirm } = sell;
  useEffect(() => {
    if (!auto) return;
    if (step !== 1) {
      if (step !== "idle") setAuto(false);
      return;
    }
    if (sp.name === "refused" || sp.name === "failed") return setAuto(false);
    if (sp.name !== "form") return;
    if (sp.failure || sp.notice) return setAuto(false);
    if (sp.refreshing) return;
    // The sheet opens on the form with no plan yet; "sell all" is what asks for the first one.
    if (!sellInputs.all) {
      if (acted.current !== "all") {
        acted.current = "all";
        sellAll();
      }
      return;
    }
    if (!sp.plan) return;
    const key = `${sp.plan.builtAt}:${sp.plan.status}`;
    if (acted.current === key) return;
    if (sp.plan.status === "needs_approval") {
      acted.current = key;
      void approve();
    } else if (sp.plan.status === "ready") {
      acted.current = key;
      void confirm();
    } else {
      setAuto(false);
    }
  }, [auto, step, sp, sellInputs.all, sellAll, approve, confirm]);

  useEffect(() => {
    if (pm && step === 1 && sell.phase.name === "idle") {
      clearPendingMigrate();
      setPm(null);
      setStep("idle");
    }
  }, [pm, step, sell.phase.name]);

  useEffect(() => {
    if (pm && pm.step === 1 && step === 1) {
      if (sell.phase.name === "signing") {
        if (!pm.sellPlan || pm.sellPlan.quoteTime !== sell.phase.plan.expiresAt - 15000) {
          const plan = sell.phase.plan;
          const updated = {
            ...pm,
            tokensSpent: plan.tokensIn,
            sourceMultiplier: plan.multiplier ?? undefined,
            sellPlan: {
              route: plan.routeText,
              vendor: plan.vendor,
              quoteTime: plan.expiresAt - 15000,
              simulation: plan.simulation ? plan.simulation.ethCall === "ok" : null,
              guaranteedUsdt: plan.minUsdtOut,
            },
          };
          writePendingMigrate(updated);
          setPm(updated);
        }
      } else if (sell.phase.name === "confirmed") {
        const updated = { ...pm, saleHash: sell.phase.hash, pollStartedAt: Date.now() };
        writePendingMigrate(updated);
        setPm(updated);
        setStep("interstitial");
        setWaitingReceipt(true);
        setReceiptState("pending");
      }
    }
  }, [pm, step, sell.phase]);

  const saleHash = pm?.saleHash;
  const usdtReceived = pm?.usdtReceived;
  const pollStartedAt = pm?.pollStartedAt;

  useEffect(() => {
    if (
      step === "interstitial" &&
      saleHash &&
      !usdtReceived &&
      waitingReceipt &&
      !terminalStateRef.current
    ) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;

      let startMs = pollStartedAt;
      if (!startMs) {
        startMs = Date.now();
        setPm((prev) => {
          if (!prev) return null;
          const updated = { ...prev, pollStartedAt: startMs };
          writePendingMigrate(updated);
          return updated;
        });
      }

      setReceiptState("pending");
      const updateElapsed = () => {
        setWaitElapsedMs(Date.now() - startMs!);
      };
      updateElapsed();
      const intervalTimer = setInterval(updateElapsed, 1000);

      const poll = async () => {
        if (!saleHash || terminalStateRef.current) return;

        try {
          const res = await fetchSaleStatus(
            saleHash,
            startMs!,
            Boolean(flagsRef.current),
            (input, init) => fetch(input, { ...init, signal: controller.signal }),
          );

          if (controller.signal.aborted && res.state === "pending") return;

          if (res.state === "confirmed") {
            terminalStateRef.current = true;
            setPm((prev) => {
              if (!prev) return null;
              const updated = {
                ...prev,
                usdtReceived: res.usdtReceivedRaw,
                step: 2 as const,
                source: res.source,
                isFixture: res.fixture ?? false,
              };
              writePendingMigrate(updated);
              return updated;
            });
            setWaitingReceipt(false);
            setReceiptState(null);
            setSource(res.source);
            setStep("interstitial");
            return;
          }

          if (res.state === "underMinimum") {
            terminalStateRef.current = true;
            clearPendingMigrate();
            setWaitingReceipt(false);
            setReceiptState("underMinimum");
            setSource(res.source);
            setPm((prev) =>
              prev
                ? {
                    ...prev,
                    usdtReceived: res.usdtReceivedRaw,
                    source: res.source,
                    isFixture: res.fixture ?? false,
                  }
                : null,
            );
            return;
          }

          if (res.state === "failed") {
            terminalStateRef.current = true;
            clearPendingMigrate();
            setWaitingReceipt(false);
            setReceiptState("failed");
            return;
          }

          if (res.state === "unrecognised" || res.state === "timeout") {
            setWaitingReceipt(false);
            setSource("wallet");
            setStep("interstitial");
            return;
          }

          if (!controller.signal.aborted && !terminalStateRef.current) {
            timer = setTimeout(poll, 5000);
          }
        } catch (e) {
          if ((e instanceof Error && e.name === "AbortError") || controller.signal.aborted) return;
          if (!terminalStateRef.current) {
            timer = setTimeout(poll, 5000);
          }
        }
      };
      void poll();

      return () => {
        controller.abort();
        clearTimeout(timer);
        clearInterval(intervalTimer);
      };
    }
  }, [step, saleHash, usdtReceived, pollStartedAt, waitingReceipt]);

  const checkAgain = useCallback(() => {
    if (pm) {
      terminalStateRef.current = false;
      const updated = { ...pm, pollStartedAt: Date.now() };
      writePendingMigrate(updated);
      setPm(updated);
      setWaitingReceipt(true);
      setReceiptState("pending");
    }
  }, [pm]);

  const resumeStep2 = useCallback(
    (manualUsdt?: string) => {
      let raw = pm?.usdtReceived;
      if (manualUsdt && !raw) {
        try {
          const parts = manualUsdt.split(".");
          const intPart = parts[0] || "0";
          let decPart = parts[1] || "";
          decPart = decPart.padEnd(18, "0").slice(0, 18);
          raw = intPart + decPart;
        } catch {
          return;
        }
      }

      if (pm && raw) {
        const updated = { ...pm, usdtReceived: raw };
        writePendingMigrate(updated);
        setPm(updated);
        setStep(2);
      }
    },
    [pm],
  );

  const onBuyDone = useCallback(
    (hash: string) => {
      if (pm && step === 2) {
        const updated = { ...pm, buyHash: hash };
        writePendingMigrate(updated);
        setPm(updated);
        setStep("done");
      }
    },
    [pm, step],
  );

  const onBuySigning = useCallback(
    (plan: PlanDto) => {
      if (pm && step === 2) {
        const updated = {
          ...pm,
          destMultiplier: plan.multiplier,
          buyPlan: {
            route: plan.routeText,
            vendor: plan.vendor,
            quoteTime: plan.builtAt,
            simulation: plan.simulation ? plan.simulation.ethCall === "ok" : null,
            minShares: plan.minShares,
          },
        };
        writePendingMigrate(updated);
        setPm(updated);
      }
    },
    [pm, step],
  );

  return {
    pm,
    step,
    sell,
    open,
    reviewing,
    cancelReview,
    confirmReview,
    autoSelling: auto && step === 1,
    cancel,
    dropAsk,
    askDrop,
    keepGoing,
    drop,
    restartKey,
    resumeStep2,
    waitingReceipt,
    source,
    receiptState,
    waitElapsedMs,
    checkAgain,
    onBuyDone,
    onBuySigning,
  };
}
