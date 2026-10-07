"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/motion/modal";
import { Button } from "@/components/motion/button";
import { useMigrateFlow } from "./use-migrate-flow";
import { useTradeFlow } from "./use-trade-flow";
import { TradeFlowLayer } from "./flow-host";
import { formatUnits, parseUnits } from "viem";
import { ReceiptLink } from "@/components/receipts/receipt-link";
import { Loader2, ArrowRight } from "lucide-react";

export function MigrateSheet({ flow }: { flow: ReturnType<typeof useMigrateFlow> }) {
  const { pm, step, cancel, resumeStep2, waitingReceipt, source, onBuyDone } = flow;

  const open = step !== "idle";
  const [typedProceeds, setTypedProceeds] = useState("");

  const isTypedProceedsValid = () => {
    if (!/^\d+(\.\d{1,18})?$/.test(typedProceeds)) return false;
    try {
      return parseUnits(typedProceeds, 18) >= 6000000000000000000n;
    } catch {
      return false;
    }
  };

  if (!pm) return null;

  if (step === 1) {
    return null;
  }

  if (step === 2) {
    return <MigrateBuyStep pm={pm} cancel={cancel} onDone={onBuyDone} />;
  }

  const fromSymbol = pm.from === "ondo" ? `${pm.ticker}on` : `${pm.ticker}B`;
  const toSymbol = pm.to === "ondo" ? `${pm.ticker}on` : `${pm.ticker}B`;

  // Interstitial or Done
  if (step === "interstitial" || step === "done") {
    return (
      <Modal
        open={open}
        onOpenChange={(o) => {
          if (!o) cancel();
        }}
        title={`Migrate to ${pm.to === "ondo" ? "Ondo" : "bStock"}`}
        description="Two separate transactions; the price can move between them."
        className="max-w-[520px]"
      >
        <div className="mt-4 grid gap-4">
          {step === "interstitial" && waitingReceipt ? (
            <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
              <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
              <p className="text-sm">Waiting for the sale to confirm...</p>
            </div>
          ) : step === "interstitial" ? (
            <div className="grid gap-4">
              <div className="rounded-lg border border-neutral-200 p-4 space-y-2 text-sm">
                <p>
                  Sold {fromSymbol} for{" "}
                  {pm.usdtReceived ? formatUnits(BigInt(pm.usdtReceived), 18) : "?"} USDT. Not
                  bought yet. Your USDT is in your wallet.
                </p>
                {source === "wallet" ? (
                  <div className="mt-4">
                    <p className="text-neutral-500 mb-2">
                      Check your wallet for the exact USDT received, and enter it below:
                    </p>
                    <input
                      type="text"
                      className="input num w-full"
                      value={typedProceeds}
                      onChange={(e) => setTypedProceeds(e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder="e.g. 6.0"
                    />
                  </div>
                ) : null}
              </div>
              <div className="flex justify-end">
                <Button
                  disabled={source === "wallet" && !isTypedProceedsValid()}
                  onClick={() => resumeStep2(source === "wallet" ? typedProceeds : undefined)}
                >
                  Buy now
                </Button>
              </div>
            </div>
          ) : step === "done" ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between rounded-lg border border-neutral-200 p-4">
                <div className="space-y-1">
                  <p className="font-medium text-sm">Step 1: Sold to USDT</p>
                  {pm.saleHash ? <ReceiptLink hash={pm.saleHash} /> : null}
                </div>
                <ArrowRight className="h-4 w-4 text-neutral-400" />
                <div className="space-y-1 text-right">
                  <p className="font-medium text-sm">Step 2: Bought destination</p>
                  {pm.buyHash ? <ReceiptLink hash={pm.buyHash} /> : null}
                </div>
              </div>
              <p className="text-sm text-neutral-500 text-center">
                Your {fromSymbol} shares have been migrated to{" "}
                {pm.to === "ondo" ? "Ondo" : "bStock"} ({toSymbol}) using{" "}
                {pm.usdtReceived ? formatUnits(BigInt(pm.usdtReceived), 18) : "?"} USDT.
              </p>
              <div className="flex justify-center mt-2">
                <Button onClick={cancel}>Done</Button>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    );
  }

  return null;
}

function MigrateBuyStep({
  pm,
  cancel,
  onDone,
}: {
  pm: NonNullable<ReturnType<typeof useMigrateFlow>["pm"]>;
  cancel: () => void;
  onDone: (hash: string) => void;
}) {
  const buy = useTradeFlow();

  useEffect(() => {
    if (pm.usdtReceived && buy.phase.name === "idle") {
      const usd = Number(formatUnits(BigInt(pm.usdtReceived), 18));
      buy.start({
        ticker: pm.ticker,
        issuer: pm.to,
        symbol: pm.to === "ondo" ? `${pm.ticker}on` : `${pm.ticker}B`,
        usd,
        tolerancePct: 1,
      });
    }
  }, [pm, buy]);

  useEffect(() => {
    if (buy.phase.name === "done" && buy.phase.receipt.txHash) {
      onDone(buy.phase.receipt.txHash);
    }
  }, [buy.phase, onDone]);

  // If the user cancels the buy modal, we abort the migration entirely
  useEffect(() => {
    if (buy.phase.name === "idle") {
      // Wait, we shouldn't automatically cancel if idle because it starts out idle.
    }
  }, [buy.phase.name]);

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape" && buy.phase.name === "idle") cancel();
      }}
    >
      <TradeFlowLayer flow={buy} />
    </div>
  );
}
