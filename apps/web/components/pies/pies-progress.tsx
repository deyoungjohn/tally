"use client";
// The run of a basket: one row per stock (waiting, signing, done with a receipt link, failed with the plain reason, not started),
// stopping at the first failure with an explicit "Continue with the remaining legs". Reads the hook's run state only.

import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { moneyE18 } from "./money";
import { Button } from "@/components/motion/button";
import { TokenIcon } from "@/components/ui/token-icon";
import type { PieBuyRun, PieBuyRunLeg } from "./use-pie-run";

const STAGE: Record<string, string> = {
  planning: "Getting the price",
  approval: "Approve in your wallet",
  buy: "Confirm the buy in your wallet",
};

function LegStatus({ leg }: { leg: PieBuyRunLeg }) {
  if (leg.status === "done")
    return (
      <span className="inline-flex items-center gap-1.5 text-up">
        <Check size={15} aria-hidden /> Done
      </span>
    );
  if (leg.status === "failed")
    return (
      <span className="inline-flex items-center gap-1.5 text-red">
        <AlertTriangle size={15} aria-hidden /> Failed
      </span>
    );
  if (leg.status === "signing" || leg.status === "pending")
    return (
      <span className="inline-flex items-center gap-1.5 text-fg">
        <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden />
        {leg.status === "signing" ? "Signing" : "Waiting"}
        {leg.stage ? ` · ${STAGE[leg.stage] ?? leg.stage}` : ""}
      </span>
    );
  return <span className="text-fg3">Not started</span>;
}

export function PiesProgress({
  run,
  canContinue,
  onContinue,
  onClear,
  error,
}: {
  run: PieBuyRun;
  canContinue: boolean;
  onContinue: () => void;
  onClear: () => void;
  error: string | null;
}) {
  const done = run.legs.filter((l) => l.status === "done");
  const failed = run.legs.find((l) => l.status === "failed");
  const notStarted = run.legs.filter((l) => l.status === "not_started").length;
  const spent = done.reduce((a, l) => a + BigInt(l.amountUsdt), 0n);
  return (
    <section
      className="glass p-5 min-[561px]:p-6"
      aria-label="Basket progress"
      data-testid="pies-progress"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="t-h3">
          {run.status === "done"
            ? "Basket bought"
            : failed
              ? "Basket stopped"
              : "Buying your basket"}
        </h2>
        <p className="t-meta">
          Status: <span data-testid="pie-status">{run.status}</span>
        </p>
      </div>
      {run.status === "running" ? (
        <p className="t-meta mt-1">
          One stock at a time. Confirm each step in your wallet; keep this page open.
        </p>
      ) : null}
      <ol className="m-0 mt-4 grid list-none gap-2 p-0">
        {run.legs.map((leg) => (
          <li
            key={leg.id}
            className="panel flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3"
            data-testid={`pie-leg-${leg.ticker}`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <TokenIcon ticker={leg.ticker} size={24} />
              <span className="font-semibold">{leg.symbol}</span>
              <span className="num text-fg2">${moneyE18(leg.amountUsdt)}</span>
            </span>
            <span className="flex items-center gap-3 text-[15px]">
              <LegStatus leg={leg} />
              {leg.txHash ? (
                <a
                  className="link-text"
                  href={`https://bscscan.com/tx/${leg.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${leg.symbol}: receipt on BscScan (opens in a new tab)`}
                >
                  Receipt
                </a>
              ) : null}
            </span>
            {leg.status === "failed" && leg.reason ? (
              <span className="basis-full text-[15px] text-red" role="alert">
                {leg.reason}
              </span>
            ) : null}
            {leg.receiptWarning ? (
              <span className="basis-full t-meta">{leg.receiptWarning}</span>
            ) : null}
          </li>
        ))}
      </ol>
      {failed ? (
        <p className="mt-3 text-[15px]" role="status" data-testid="pies-stopped">
          Stopped at the first failure. {done.length} bought, {failed.symbol} did not go through,{" "}
          {notStarted} not started. Nothing retries on its own.
        </p>
      ) : null}
      {run.status === "done" ? (
        <p className="mt-3 text-[15px]" data-testid="pies-summary">
          {done.length} {done.length === 1 ? "stock" : "stocks"} bought for ${moneyE18(spent)} in
          total. Each receipt is linked above.
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-[15px] text-red" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        {canContinue ? (
          <Button onClick={onContinue} data-testid="pies-continue">
            Continue with the remaining legs
          </Button>
        ) : null}
        {run.status !== "running" ? (
          <Button variant="glassy" onClick={onClear} data-testid="pies-dismiss">
            {run.status === "done" ? "Start another basket" : "Discard this run"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
