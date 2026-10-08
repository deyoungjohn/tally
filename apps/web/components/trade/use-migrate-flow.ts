"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSellFlow, type SellTarget } from "./use-sell-flow";
import type { PlanDto } from "@/lib/dto";
import {
  type PendingMigrate,
  readPendingMigrate,
  writePendingMigrate,
  clearPendingMigrate,
} from "../../lib/migrate/state";

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
  const sell = useSellFlow();
  const wallet = useTallyWallet();
  const [pm, setPm] = useState<PendingMigrate | null>(null);
  const [step, setStep] = useState<MigrateStep>("idle");
  const [waitingReceipt, setWaitingReceipt] = useState(false);
  const [source, setSource] = useState<"receipt" | "wallet" | null>(null);
  // Migrate starts with a review dialog (what you sell, what you receive, the costs). Confirming it sells the whole holding by
  // itself: "auto" drives the sell flow's own steps (sell all, approve, sign) so nobody has to click through its form.
  const [reviewing, setReviewing] = useState<MigrateReview | null>(null);
  const [auto, setAuto] = useState(false);
  const acted = useRef("");

  useEffect(() => {
    const saved = readPendingMigrate();
    if (saved) {
      setPm(saved);
      if (saved.step === 1) {
        if (saved.saleHash) {
          setStep("interstitial");
          if (!saved.usdtReceived) setWaitingReceipt(true);
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
  }, []);

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
  const confirmReview = useCallback(async () => {
    if (!reviewing) return;
    const r = reviewing;
    setReviewing(null);
    acted.current = "";
    setAuto(true);
    await begin(r.target, r.to);
  }, [reviewing, begin]);

  const cancel = useCallback(() => {
    setAuto(false);
    setReviewing(null);
    clearPendingMigrate();
    setPm(null);
    setStep("idle");
    setWaitingReceipt(false);
    sell.close();
  }, [sell]);

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
        const updated = { ...pm, saleHash: sell.phase.hash };
        writePendingMigrate(updated);
        setPm(updated);
        setStep("interstitial");
        setWaitingReceipt(true);
      }
    }
  }, [pm, step, sell.phase]);

  useEffect(() => {
    if (step === "interstitial" && pm && pm.saleHash && !pm.usdtReceived && waitingReceipt) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;

      const poll = async (retries = 0) => {
        if (!pm.saleHash) return;
        try {
          const res = await fetch(`/api/receipts?hash=${pm.saleHash}`, {
            signal: controller.signal,
          });
          if (res.status === 404) {
            if (flags.receipts && retries < 24) {
              timer = setTimeout(() => poll(retries + 1), 5000);
              return;
            }
            setWaitingReceipt(false);
            setSource("wallet");
            setStep("interstitial");
            return;
          }

          if (res.ok) {
            const data = await res.json();
            if (data.state === "reconciled" && data.usdtReceivedRaw) {
              const raw = BigInt(data.usdtReceivedRaw);
              if (raw >= 6000000000000000000n) {
                const updated = { ...pm, usdtReceived: data.usdtReceivedRaw, step: 2 as const };
                writePendingMigrate(updated);
                setPm(updated);
                setWaitingReceipt(false);
                setSource("receipt");
                setStep("interstitial");
                return;
              }
            }
          }

          timer = setTimeout(() => poll(retries + 1), 5000);
        } catch {
          timer = setTimeout(() => poll(retries + 1), 5000);
        }
      };
      poll(0);

      return () => {
        controller.abort();
        clearTimeout(timer);
      };
    }
  }, [step, pm, waitingReceipt, wallet.address, flags.receipts]);

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
    resumeStep2,
    waitingReceipt,
    source,
    onBuyDone,
    onBuySigning,
  };
}
