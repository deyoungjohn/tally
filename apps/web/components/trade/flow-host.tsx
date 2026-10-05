"use client";

import { AnimatePresence, motion } from "motion/react";
import { SPRING_SWAP } from "@/lib/ease";
import { ProgressIsland, ReceiptModal, ReviewSheet, SignInSheet, TopUpSheet } from "./flow-sheets";
import type { FlowPhase, useTradeFlow } from "./use-trade-flow";

/** What the main action button says, from the state of the transaction. "Sell" and "Migrate" will slot in here when they exist. */
export function flowActionLabel(phase: FlowPhase, idle: string): string {
  switch (phase.name) {
    case "signin":
      return "Signing in…";
    case "quoting":
      return "Getting your price…";
    case "topup":
      return "Add funds to continue";
    case "approve":
      return phase.step === "sign" ? "Approve USDT in your wallet" : "Approving…";
    case "review":
      return "Review your buy";
    case "swap":
      return phase.step === "sign" ? "Confirm in your wallet" : "Buying…";
    case "done":
      return "Bought ✓";
    case "error":
      return "Try again";
    default:
      return idle;
  }
}

/** The label swaps with a short slide-and-blur (beUI action-swap idea) so a state change reads as a change. */
export function ActionLabel({ text }: { text: string }) {
  return (
    <span className="relative inline-flex overflow-hidden" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={text}
          initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
          transition={SPRING_SWAP}
          className="inline-block"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Everything a buy shows besides the page itself: the progress pill, sign-in, top-up and review. Used by Home and Trade. */
export function TradeFlowLayer({ flow }: { flow: ReturnType<typeof useTradeFlow> }) {
  const { phase } = flow;
  const params = flow.params.current;
  return (
    <>
      <ProgressIsland phase={phase} />
      <SignInSheet open={phase.name === "signin"} onClose={flow.cancel} />
      {params ? (
        <TopUpSheet
          plan={phase.name === "topup" ? phase.plan : null}
          params={params}
          onFunded={() => void flow.run()}
          onClose={flow.cancel}
        />
      ) : null}
      <ReviewSheet
        plan={phase.name === "review" ? phase.plan : null}
        notice={phase.name === "review" ? phase.notice : undefined}
        onConfirm={() => void flow.confirm()}
        onClose={flow.cancel}
      />
      <ReceiptModal
        open={phase.name === "done"}
        receipt={phase.name === "done" ? phase.receipt : null}
        plan={phase.name === "done" ? phase.plan : undefined}
        ticker={params?.ticker ?? ""}
        symbol={params?.symbol ?? params?.ticker ?? ""}
        onDismiss={flow.cancel}
      />
    </>
  );
}
