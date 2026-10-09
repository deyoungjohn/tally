"use client";

import { useEffect, useRef, useState } from "react";
import type { ReceiptDto } from "@/lib/dto";
import { useModuleFlagsState } from "@/lib/hooks/use-flags";
import { notifyPortfolioChanged } from "@/lib/hooks/portfolio-changed";
import { isTokenBuyable } from "@/lib/tickers";
import { useTallyWallet } from "@/components/wallet/wallet-context";
import { fetchPlan } from "@/components/trade/use-trade-flow";
import { createPieRunner } from "./use-pie-run-driver";
import type { PieBuyRun, PieRunInput } from "./use-pie-run-state";
export type { PieBuyRun, PieBuyRunLeg, PieRunInput } from "./use-pie-run-state";

export { createPieRunner } from "./use-pie-run-driver";
export type { PieRunTransport } from "./use-pie-run-driver";

async function receiptFetch(hash: string, ticker: string, symbol: string): Promise<ReceiptDto> {
  const response = await fetch(
    `/api/trade/receipt?${new URLSearchParams({ tx: hash, ticker, symbol })}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Receipt source is unavailable");
  return response.json() as Promise<ReceiptDto>;
}
export function usePieRun(options: { fixtures?: boolean } = {}) {
  const wallet = useTallyWallet();
  const flags = useModuleFlagsState();
  const latest = useRef({ wallet, flags });
  latest.current = { wallet, flags };
  const [run, setRun] = useState<PieBuyRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runner = useRef<ReturnType<typeof createPieRunner> | null>(null);
  useEffect(() => {
    let storage: Storage;
    try {
      storage = window.localStorage;
    } catch {
      setError("Browser storage is unavailable; basket signing is disabled");
      return;
    }
    const active = createPieRunner(
      {
        wallet: () => latest.current.wallet,
        enabled: () => latest.current.flags.flags.pies === true,
        tokenEnabled: (ticker) => isTokenBuyable(ticker, "bstock"),
        storage,
        plan: fetchPlan,
        receipt: receiptFetch,
        txStatus: async (hash) => {
          const response = await fetch(`/api/trade/tx-status?${new URLSearchParams({ hash })}`, {
            cache: "no-store",
          });
          if (!response.ok) throw new Error("Transaction status is unavailable");
          return response.json() as Promise<{ status: "pending" | "success" | "reverted" }>;
        },
        now: Date.now,
        sleep: () => new Promise((resolve) => setTimeout(resolve, 3000)),
        id: () => crypto.randomUUID(),
        changed: notifyPortfolioChanged,
        onWarn: console.warn,
      },
      setRun,
    );
    runner.current = active;
    return () => {
      active.dispose();
      runner.current = null;
    };
  }, []);
  useEffect(() => {
    if (wallet.ready && flags.ready)
      void runner.current
        ?.restore()
        .catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : "Cannot restore basket"),
        );
  }, [wallet.ready, wallet.authenticated, wallet.address, flags.ready]);
  const call = async (action: () => Promise<void> | undefined) => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Basket could not start");
    }
  };
  return {
    run,
    error,
    ready: wallet.ready && flags.ready && flags.flags.pies === true,
    fixtures: options.fixtures === true,
    start: (plan: PieRunInput) => call(() => runner.current?.start(plan)),
    continueRemaining: () => call(() => runner.current?.continueRemaining()),
    clear: () => runner.current?.clear(),
    canContinue:
      !!run &&
      !["running", "done"].includes(run.status) &&
      !run.legs.some((leg) => leg.signatureUncertain),
  };
}
