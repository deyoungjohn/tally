"use client";
// The share page for one transaction, built from the receipts module's `ReceiptVM`: the Quoted → Simulated → Received ladder
// for buys and sells, with anything the browser reported labelled as such and a pending receipt shown as pending. It needs
// no wallet, so the link works signed out. No contract address is shown; the transaction links to BscScan.

import { ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { ButtonLink } from "@/components/motion/button";
import { Tip } from "@/components/ui/tooltip";
import { fmtUsd, shortHash } from "@/lib/format";
import { dec3, dec3Down, usdt2, usdt2Down } from "@/lib/receipt-format";
import { useJson } from "@/lib/hooks/use-json";
import { nameOf } from "@/lib/tickers";
import type { ReceiptVM } from "@/modules/receipts/view-model";
import { VmEmpty, VmFreshness, ageText } from "@/components/portfolio/vm-shared";

type Status = NonNullable<ReceiptVM["status"]>;

const STATUS: Record<Status, { label: string; tone: string; tip: string }> = {
  RECONCILED: {
    label: "Matches the quote",
    tone: "badge-up",
    tip: "The amount received is within the expected range of the quote.",
  },
  RECONCILED_WITH_DIFFERENCE: {
    label: "Verified",
    tone: "badge-up",
    tip: "The chain confirms this transaction and the amount you received. The amount differs from the quote, which can happen when prices drift.",
  },
  PENDING: {
    label: "Pending",
    tone: "badge-amber",
    tip: "The transaction is not confirmed on chain yet, so nothing is claimed about the result.",
  },
  FAILED: {
    label: "Failed on chain",
    tone: "badge-amber",
    tip: "The transaction was mined but reverted. No tokens were exchanged.",
  },
  UNRECONCILED: {
    label: "Evidence incomplete",
    tone: "badge-amber",
    tip: "The chain shows the transaction, but not enough evidence was recorded to check the result.",
  },
};

/** An 18-decimal integer string as a plain decimal with up to six places; null stays null (never a guess). */
function fmtE18(raw: string | null): string | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = BigInt(raw);
  const frac = (n % 10n ** 18n).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return `${n / 10n ** 18n}${frac ? `.${frac}` : ""}`;
}

/** Amounts print to 3 decimals; a USDT value rounds up to 2 (see `lib/receipt-format`). */
const dec = (v: string | null) => dec3(v);

const bps = (v: number | null) =>
  v === null ? null : `${v > 0 ? "+" : ""}${(v / 100).toFixed(2)}%`;

function Step({
  stage,
  step,
  sell,
}: {
  stage: ReceiptVM["ladder"][number];
  step: number;
  sell: boolean;
}) {
  const unit = sell && stage.stage === "Received" ? "USDT" : sell ? "tokens offered" : "shares";
  // Sells ladder in tokens (and USDT), buys in shares.
  const raw = sell ? stage.tokens : stage.shares;
  const main = sell && stage.stage === "Received" ? usdt2(raw) : dec(raw);
  return (
    <li
      className="panel list-none p-4"
      data-testid={`receipt-step-${stage.stage}`}
      aria-label={stage.stage}
    >
      <div className="flex items-start gap-3">
        <span className="mono mt-1 text-[13px] text-fg3" aria-hidden>
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{stage.stage}</p>
          {main === null ? (
            <p className="mt-1 text-fg2" data-testid={`receipt-step-reason-${stage.stage}`}>
              -
            </p>
          ) : (
            <p className="mt-1">
              <span className="num text-[23px] font-bold tracking-tight">{main}</span>{" "}
              <span className="text-fg2">{unit}</span>
            </p>
          )}
          {!sell && stage.tokens ? <p className="t-meta">{dec(stage.tokens)} tokens</p> : null}
        </div>
      </div>
    </li>
  );
}

/** What the chain itself says about the transaction, read by the page when Tally's own check has not finished. */
export interface ChainCheck {
  block: string;
  ok: boolean;
}

export function ReceiptView({
  vm,
  fixtures,
  qualityOn,
  chain = null,
}: {
  vm: ReceiptVM;
  fixtures: boolean;
  qualityOn: boolean;
  chain?: ChainCheck | null;
}) {
  const router = useRouter();
  // While Tally is still checking the amounts, read the page again every few seconds until they are in.
  const waiting = vm.state === "pending";
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => router.refresh(), 6_000);
    return () => window.clearInterval(id);
  }, [waiting, router]);
  const what = vm.kind === "sell" ? "sell" : vm.kind === "swap" ? "buy" : "transaction";
  // The token symbol when the view model knows the issuer; the stock's name otherwise (never a bare ticker).
  const title = vm.symbol
    ? `${vm.symbol} ${what} receipt`
    : vm.ticker
      ? `${nameOf(vm.ticker)} ${what} receipt`
      : "Transaction receipt";
  const bscscan = vm.evidence.explorerUrl;
  const gas = useJson<{ gasUsd?: number | null }>(
    vm.txHash && vm.state !== "pending" ? `/api/trade/receipt?tx=${vm.txHash}` : null,
  );
  if (vm.state === "empty" || vm.state === "error" || vm.state === "disabled")
    return (
      <>
        <VmEmpty
          title={vm.state === "error" ? "That isn't a transaction hash" : "No receipt yet"}
          reason={
            vm.state === "empty"
              ? "Tally has not recorded this transaction yet. A receipt appears after the transaction is mined and checked."
              : (vm.reason ?? "Receipt unavailable.")
          }
        >
          {bscscan ? (
            <a
              className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 link-text"
              href={bscscan}
              target="_blank"
              rel="noreferrer"
            >
              View the transaction on BscScan <ExternalLink size={13} aria-hidden />
            </a>
          ) : null}
        </VmEmpty>
      </>
    );

  // The chain has confirmed it even if Tally has not finished reading the amounts: never say "Pending" then.
  const status =
    vm.status === "PENDING" && chain
      ? chain.ok
        ? {
            label: "Confirmed",
            tone: "badge-up",
            tip: "BNB Smart Chain has confirmed the transaction. Tally is still reading the amounts.",
          }
        : STATUS.FAILED
      : vm.status
        ? STATUS[vm.status]
        : null;
  const sell = vm.kind === "sell";
  // The "Simulated" step is never shown: a sell records no simulation output and a buy's is almost always unavailable.
  const ladder = vm.ladder.filter((s) => s.stage !== "Simulated");
  // A guarantee rounds down: rounding it up would promise more than was signed.
  // (the stored text can carry a note after the number; only the number is shown)
  const floorNumber = vm.signedMinimumShares?.split(" ")[0] ?? null;
  const minimum = sell ? usdt2Down(floorNumber) : dec3Down(floorNumber);
  const multiplier = fmtE18(vm.evidence.multiplier);
  const diffQuote = bps(vm.diffVsQuoteBps);
  return (
    <>
      <p className="t-kicker">Receipt</p>
      <h1 className="t-h2 mt-3 max-w-[22ch]" data-testid="receipt-title">
        {title}
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {status ? (
          <Tip text={status.tip}>
            <span className={`badge ${status.tone}`} data-testid="receipt-status">
              {status.label}
            </span>
          </Tip>
        ) : null}
        <span className="mono text-[13px] text-fg3">{shortHash(vm.txHash)}</span>
      </div>
      {vm.reason && vm.status === "FAILED" ? (
        <p className="t-lead mt-3 max-w-[62ch]" data-testid="receipt-reason">
          {vm.reason}
        </p>
      ) : null}

      {vm.state === "pending" ? (
        <p
          className="mt-4 rounded-xl border border-line p-4 text-fg2"
          role="status"
          data-testid="receipt-pending"
        >
          {chain
            ? chain.ok
              ? `Confirmed on BNB Smart Chain in block ${chain.block}. Tally is reading the amounts; this page updates by itself.`
              : `This transaction failed on BNB Smart Chain (block ${chain.block}). Nothing was exchanged.`
            : "Waiting for BNB Smart Chain to confirm this transaction. This page updates by itself."}
        </p>
      ) : null}

      {vm.ladder.length ? (
        <ol
          className="m-0 mt-6 grid max-w-[640px] list-none gap-3 p-0"
          aria-label="Quote, received"
        >
          {ladder.map((s, i) => (
            <Step key={s.stage} stage={s} step={i + 1} sell={sell} />
          ))}
        </ol>
      ) : null}

      {vm.ladder.length ? (
        <dl className="m-0 mt-6 grid max-w-[640px] gap-3" data-testid="receipt-compare">
          {minimum ? (
            <div>
              <dt className="t-meta">{sell ? "Least you'd receive" : "Minimum you signed"}</dt>
              <dd className="m-0">
                {sell ? `${minimum} USDT` : `${minimum} shares`}
                {sell ? null : <span className="t-meta"> (the transaction fails below this)</span>}
              </dd>
            </div>
          ) : null}
          {diffQuote ? (
            <div>
              <dt className="t-meta">Received vs quote</dt>
              <dd className="m-0" data-testid="receipt-diff-quote">
                {diffQuote}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <section className="glass mt-8 max-w-[640px] p-5" aria-label="Evidence">
        <h2 className="t-h3">Evidence</h2>
        <dl className="m-0 mt-3 grid gap-2 text-[14.5px]">
          <div>
            <dt className="t-meta">Block</dt>
            <dd className="m-0">{vm.evidence.block ?? chain?.block ?? "-"}</dd>
          </div>
          <div>
            <dt className="t-meta">Gas used / limit</dt>
            <dd className="m-0">
              {vm.evidence.gasUsed ?? "-"} / {vm.evidence.gasLimit ?? "-"}
              {typeof gas.data?.gasUsd === "number"
                ? ` (≈ ${fmtUsd(gas.data.gasUsd, 3)} used)`
                : ""}
            </dd>
          </div>
          {multiplier ? (
            <div>
              <dt className="t-meta">Shares per token when checked</dt>
              <dd className="m-0">{multiplier}</dd>
            </div>
          ) : null}
        </dl>
        {bscscan ? (
          <a
            className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 link-text"
            href={bscscan}
            target="_blank"
            rel="noreferrer"
          >
            View on BscScan <ExternalLink size={13} aria-hidden />
          </a>
        ) : null}
      </section>

      <div className="mt-4 max-w-[640px]">
        <VmFreshness
          stale={vm.stale}
          ageMs={vm.ageMs}
          source={vm.source}
          fixtures={fixtures}
          asOf={vm.observedAt ?? null}
        />
        {vm.stale ? (
          <p className="t-meta mt-1">Last verified {ageText(vm.ageMs) ?? "a while ago"}.</p>
        ) : null}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href="/trade">Compare a stock</ButtonLink>
        {qualityOn ? (
          <Link href="/trade?tab=fills" className="inline-flex min-h-[44px] items-center link-text">
            Live fills
          </Link>
        ) : null}
      </div>
    </>
  );
}
