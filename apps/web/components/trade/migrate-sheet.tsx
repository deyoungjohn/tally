"use client";

import { Modal } from "@/components/motion/modal";
import { Button } from "@/components/motion/button";
import { useMigrateFlow } from "./use-migrate-flow";
import { SellSheet } from "./sell-sheet";
import { TradeFlowLayer } from "./flow-host";
import { formatUnits } from "viem";
import { roundDownToCent } from "../../lib/migrate/state";
import { ReceiptLink } from "@/components/receipts/receipt-link";
import { Loader2, ArrowRight } from "lucide-react";
import { fmtShares } from "@/lib/format";

export function MigrateSheet({ flow }: { flow: ReturnType<typeof useMigrateFlow> }) {
  const { pm, step, sell, buy, cancel, resumeStep2, waitingReceipt, source } = flow;

  const open = step !== "idle";

  if (!pm) return null;

  if (step === 1) {
    return <SellSheet flow={sell} />;
  }

  if (step === 2) {
    return <TradeFlowLayer flow={buy} />;
  }

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
                  Sold {pm.ticker} for{" "}
                  {pm.usdtReceived ? formatUnits(BigInt(pm.usdtReceived), 18) : "?"} USDT. Not
                  bought yet. Your USDT is in your wallet.
                </p>
                {source === "wallet" ? (
                  <p className="text-neutral-500">(from your wallet balance)</p>
                ) : null}
              </div>
              <div className="flex justify-end">
                <Button onClick={resumeStep2}>Buy now</Button>
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
                Your shares have been migrated.
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
