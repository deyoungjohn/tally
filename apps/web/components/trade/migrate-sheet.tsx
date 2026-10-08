"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/motion/modal";
import { Button, ButtonLink } from "@/components/motion/button";
import { useMigrateFlow } from "./use-migrate-flow";
import { useTradeFlow } from "./use-trade-flow";
import { TradeFlowLayer } from "./flow-host";
import { formatUnits, parseUnits } from "viem";

import { Loader2 } from "lucide-react";
import { roundDownToCent } from "@/lib/migrate/state";
import { MigrateReceiptModal } from "./migrate-receipt";
import { MigrateReviewModal, MigrateSellProgress } from "./migrate-review";
import type { PlanDto } from "@/lib/dto";

/** Everything Migrate shows: the review, the automatic sale's progress, then the later steps. */
export function MigrateSheet({ flow }: { flow: ReturnType<typeof useMigrateFlow> }) {
  const sp = flow.sell.phase;
  return (
    <>
      <MigrateReviewModal
        review={flow.reviewing}
        onConfirm={() => void flow.confirmReview()}
        onClose={flow.cancelReview}
      />
      {flow.autoSelling ? (
        <MigrateSellProgress
          phaseName={sp.name}
          approving={sp.name === "approve" ? sp.step : null}
          symbol={flow.pm?.from === "ondo" ? `${flow.pm.ticker}on` : `${flow.pm?.ticker ?? ""}B`}
          onCancel={flow.cancel}
        />
      ) : null}
      <MigrateSteps flow={flow} />
    </>
  );
}

function MigrateSteps({ flow }: { flow: ReturnType<typeof useMigrateFlow> }) {
  const {
    pm,
    step,
    cancel,
    resumeStep2,
    waitingReceipt,
    source,
    receiptState,
    waitElapsedMs,
    checkAgain,
    onBuyDone,
    onBuySigning,
  } = flow;

  const open = step !== "idle";
  const [typedProceeds, setTypedProceeds] = useState("");
  const [showReceipt, setShowReceipt] = useState(false);

  const isTypedProceedsValid = () => {
    if (!/^\d+(\.\d{1,18})?$/.test(typedProceeds)) return false;
    try {
      return parseUnits(typedProceeds, 18) >= 6000000000000000000n;
    } catch {
      return false;
    }
  };

  // After a verified sale the buy follows at once: its own review (with Confirm) is the next dialog. Only when the proceeds had
  // to be typed in by hand does this step wait for the person.
  useEffect(() => {
    if (step === "interstitial" && source === "receipt" && !waitingReceipt && pm?.usdtReceived)
      resumeStep2();
  }, [step, source, waitingReceipt, pm?.usdtReceived, resumeStep2]);

  if (!pm) return null;

  if (step === 1) {
    return null;
  }

  if (step === 2) {
    return (
      <MigrateBuyStep pm={pm} cancel={cancel} onDone={onBuyDone} onBuySigning={onBuySigning} />
    );
  }

  const fromSymbol = pm.from === "ondo" ? `${pm.ticker}on` : `${pm.ticker}B`;
  const toSymbol = pm.to === "ondo" ? `${pm.ticker}on` : `${pm.ticker}B`;

  // Interstitial or Done
  if (step === "interstitial" || step === "done") {
    return (
      <>
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
              <div className="flex flex-col gap-3 rounded-lg border border-black/10 bg-white p-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 motion-safe:animate-spin text-black" />
                  <div className="flex-1">
                    <p className="text-sm text-black">Waiting for the sale to confirm...</p>
                    <p className="text-xs text-black/60 mt-1">
                      Elapsed: {Math.floor(waitElapsedMs / 1000)}s
                    </p>
                  </div>
                  {pm.saleHash && (
                    <a
                      href={`https://bscscan.com/tx/${pm.saleHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-[#F18F01] underline shrink-0"
                    >
                      BscScan
                    </a>
                  )}
                </div>
                <div className="flex justify-end mt-2">
                  <Button onClick={cancel} className="bg-white text-black border border-black/10">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : step === "interstitial" && receiptState === "failed" ? (
              <div className="grid gap-4">
                <div className="rounded-lg border border-black/10 bg-white p-4 space-y-2 text-sm text-black">
                  <p>The sale transaction failed and did not go through.</p>
                  <p>No buy is offered.</p>
                </div>
                <div className="flex justify-end">
                  <Button onClick={cancel}>Cancel</Button>
                </div>
              </div>
            ) : step === "interstitial" ? (
              <div className="grid gap-4">
                <div className="rounded-lg border border-black/10 bg-white p-4 space-y-2 text-sm text-black">
                  {source === "wallet" ? (
                    <p>
                      We could not confirm the amount automatically. Your USDT is in your wallet.
                      Check your balance and enter what you received, or try again.
                    </p>
                  ) : (
                    <p>
                      Sold {fromSymbol} for{" "}
                      {pm.usdtReceived
                        ? formatUnits(BigInt(roundDownToCent(pm.usdtReceived)), 18)
                        : "?"}{" "}
                      USDT. Not bought yet. Your USDT is in your wallet.
                    </p>
                  )}
                  {source === "wallet" ? (
                    <div className="mt-4">
                      <p className="text-black/60 mb-2">
                        Check your wallet for the exact USDT received, and enter it below:
                      </p>
                      <input
                        type="text"
                        className="input num w-full border-black/10 text-black bg-white"
                        value={typedProceeds}
                        onChange={(e) => setTypedProceeds(e.target.value.replace(/[^0-9.]/g, ""))}
                        placeholder="e.g. 6.0"
                      />
                    </div>
                  ) : null}
                </div>
                <div className="flex justify-end gap-3">
                  <Button onClick={cancel} className="bg-white text-black border border-black/10">
                    Cancel
                  </Button>
                  {source === "wallet" && (
                    <Button
                      onClick={checkAgain}
                      className="bg-white text-black border border-black/10"
                    >
                      Check again
                    </Button>
                  )}
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
                <div className="flex justify-center mt-2">
                  {pm.saleHash && pm.buyHash ? (
                    <ButtonLink
                      href={`/receipt/migrate/${pm.saleHash}/${pm.buyHash}`}
                      target="_blank"
                      rel="noreferrer"
                      data-testid="migrate-receipt-link"
                    >
                      View Migrate Receipt
                    </ButtonLink>
                  ) : (
                    <Button onClick={() => setShowReceipt(true)}>View Migrate Receipt</Button>
                  )}
                </div>

                <div className="flex justify-center space-x-4 text-xs text-black/60">
                  {pm.saleHash ? (
                    <a
                      href={`/receipt/${pm.saleHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-black"
                    >
                      Sale Receipt
                    </a>
                  ) : null}
                  {pm.buyHash ? (
                    <a
                      href={`/receipt/${pm.buyHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-black"
                    >
                      Buy Receipt
                    </a>
                  ) : null}
                </div>

                <p className="text-sm text-black/60 text-center mt-2">
                  Your {fromSymbol} shares have been migrated to{" "}
                  {pm.to === "ondo" ? "Ondo" : "bStock"} ({toSymbol}) using{" "}
                  {pm.usdtReceived
                    ? formatUnits(BigInt(roundDownToCent(pm.usdtReceived)), 18)
                    : "?"}{" "}
                  USDT.
                </p>
                <div className="flex justify-center mt-2">
                  <Button onClick={cancel} className="bg-white text-black border border-black/10">
                    Done
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </Modal>

        {showReceipt && (
          <MigrateReceiptModal open={showReceipt} onClose={() => setShowReceipt(false)} pm={pm} />
        )}
      </>
    );
  }

  return null;
}

function MigrateBuyStep({
  pm,
  cancel,
  onDone,
  onBuySigning,
}: {
  pm: NonNullable<ReturnType<typeof useMigrateFlow>["pm"]>;
  cancel: () => void;
  onDone: (hash: string) => void;
  onBuySigning: (plan: PlanDto) => void;
}) {
  const buy = useTradeFlow();

  useEffect(() => {
    if (pm.usdtReceived && buy.phase.name === "idle") {
      const usd = Number(formatUnits(BigInt(roundDownToCent(pm.usdtReceived)), 18));
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
    if (buy.phase.name === "swap" && buy.phase.step === "sign" && buy.phase.plan) {
      if (!pm.buyPlan || pm.buyPlan.quoteTime !== buy.phase.plan.builtAt) {
        onBuySigning(buy.phase.plan);
      }
    }
  }, [buy.phase, pm, onBuySigning]);

  useEffect(() => {
    if (buy.phase.name === "done" && buy.phase.receipt.txHash) {
      onDone(buy.phase.receipt.txHash);
    }
  }, [buy.phase, onDone]);

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
