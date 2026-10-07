"use client";

import { useCallback, useEffect, useState } from "react";
import { useSellFlow, type SellTarget } from "./use-sell-flow";
import { useTradeFlow } from "./use-trade-flow";
import {
  type PendingMigrate,
  readPendingMigrate,
  writePendingMigrate,
  clearPendingMigrate,
  roundDownToCent,
} from "../../lib/migrate/state";
import { formatUnits } from "viem";
import { useTallyWallet } from "@/components/wallet/wallet-context";

export type MigrateStep = 1 | 2 | "interstitial" | "done" | "idle";

export function useMigrateFlow() {
  const sell = useSellFlow();
  const buy = useTradeFlow();
  const wallet = useTallyWallet();
  const [pm, setPm] = useState<PendingMigrate | null>(null);
  const [step, setStep] = useState<MigrateStep>("idle");
  const [waitingReceipt, setWaitingReceipt] = useState(false);
  const [source, setSource] = useState<"receipt" | "wallet" | null>(null);

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
          setStep(2);
        }
      }
    }
  }, []);

  const open = useCallback(
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

  const cancel = useCallback(() => {
    clearPendingMigrate();
    setPm(null);
    setStep("idle");
    setWaitingReceipt(false);
    sell.close();
    buy.cancel();
  }, [sell, buy]);

  useEffect(() => {
    if (pm && step === 1 && sell.phase.name === "idle") {
      clearPendingMigrate();
      setPm(null);
      setStep("idle");
    }
  }, [pm, step, sell.phase.name]);

  useEffect(() => {
    if (pm && pm.step === 1 && step === 1) {
      if (sell.phase.name === "confirmed") {
        const updated = { ...pm, saleHash: sell.phase.hash };
        writePendingMigrate(updated);
        setPm(updated);
        setStep("interstitial");
        setWaitingReceipt(true);
      }
    }
  }, [pm, step, sell.phase.name, sell.phase]);

  useEffect(() => {
    if (step === "interstitial" && pm && pm.saleHash && !pm.usdtReceived && waitingReceipt) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;

      const poll = async () => {
        if (!pm.saleHash) return;
        try {
          const res = await fetch(`/api/receipts?hash=${pm.saleHash}`, {
            signal: controller.signal,
          });
          if (res.status === 404) {
            if (wallet.address) {
              const pRes = await fetch(`/api/portfolio?address=${wallet.address}`, {
                signal: controller.signal,
              });
              if (pRes.ok) {
                const pData = await pRes.json();
                const usdtAfter = pData.wallet?.usdt ?? 0;
                const before = Number(pm.usdtBefore ?? 0);
                const diff = Math.max(0, usdtAfter - before);
                const raw = BigInt(Math.floor(diff * 1e18)).toString();
                const updated = { ...pm, usdtReceived: raw, step: 2 as const };
                writePendingMigrate(updated);
                setPm(updated);
                setWaitingReceipt(false);
                setSource("wallet");
                setStep("interstitial");
              } else {
                timer = setTimeout(poll, 3000);
              }
            } else {
              timer = setTimeout(poll, 3000);
            }
            return;
          }

          if (res.ok) {
            const data = await res.json();
            if (data.state === "reconciled" && data.usdtReceivedRaw) {
              const updated = { ...pm, usdtReceived: data.usdtReceivedRaw, step: 2 as const };
              writePendingMigrate(updated);
              setPm(updated);
              setWaitingReceipt(false);
              setSource("receipt");
              setStep("interstitial");
              return;
            }
          }

          timer = setTimeout(poll, 3000);
        } catch {
          timer = setTimeout(poll, 3000);
        }
      };
      poll();

      return () => {
        controller.abort();
        clearTimeout(timer);
      };
    }
  }, [step, pm, waitingReceipt, wallet.address]);

  const resumeStep2 = useCallback(() => {
    if (pm && pm.usdtReceived) {
      const rawDown = roundDownToCent(pm.usdtReceived);
      const usd = Number(formatUnits(BigInt(rawDown), 18));
      buy.start({
        ticker: pm.ticker,
        issuer: pm.to,
        symbol: pm.to === "ondo" ? `${pm.ticker}on` : `${pm.ticker}B`,
        usd,
        tolerancePct: 1,
      });
      setStep(2);
    }
  }, [pm, buy]);

  useEffect(() => {
    if (pm && step === 2 && buy.phase.name === "done") {
      const updated = { ...pm, buyHash: buy.phase.receipt.txHash };
      writePendingMigrate(updated);
      setPm(updated);
      setStep("done");
    }
  }, [pm, step, buy.phase.name, buy.phase]);

  return { pm, step, sell, buy, open, cancel, resumeStep2, waitingReceipt, source };
}
