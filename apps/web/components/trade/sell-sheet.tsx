"use client";

import { AlertTriangle, Check, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/motion/button";
import { Modal } from "@/components/motion/modal";
import { Segmented } from "@/components/motion/segmented";
import { PercentSlider } from "@/components/ui/percent-slider";
import { fmtShares, fmtUsd, shortHash } from "@/lib/format";
import { bnbText, sharesText, toSellSheet, tokensText, usdtText } from "@/lib/sell/view";
import { SELL_TOLERANCES, parseShares, type useSellFlow } from "./use-sell-flow";

type Flow = ReturnType<typeof useSellFlow>;

const STATUS_LINE: Record<string, string> = {
  loading: "Checking whether this token can be sold…",
  signing: "Confirm the sale in your wallet.",
};

/** The sell sheet: a centered modal that follows the plan's own status (needs funds, needs approval, ready) and then the transaction. */
export function SellSheet({ flow }: { flow: Flow }) {
  const { phase, target } = flow;
  const open = phase.name !== "idle";
  // While a wallet prompt is open or a sent sale is being watched, the sheet stays: closing then would lose the hash.
  const locked =
    phase.name === "signing" ||
    phase.name === "approve" ||
    (phase.name === "mining" && !phase.slow);
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o && !locked) flow.close();
      }}
      title={target ? `Sell ${target.symbol}` : "Sell"}
      description="To USDT, on BNB Smart Chain."
      showClose={!locked}
      className="max-w-[520px]"
    >
      <div data-testid="sell-sheet" data-phase={phase.name} className="mt-3 grid gap-4">
        {phase.name === "loading" ? (
          <div role="status" aria-live="polite" className="grid gap-3" data-testid="sell-loading">
            <p className="t-meta">{STATUS_LINE.loading}</p>
            <div className="skeleton h-[44px]" />
            <div className="skeleton h-[120px]" />
          </div>
        ) : null}

        {phase.name === "refused" ? (
          <>
            <Notice tone="red" testId="sell-refused">
              {phase.failure.message}
            </Notice>
            <Button variant="glassy" onClick={flow.close}>
              Close
            </Button>
          </>
        ) : null}

        {phase.name === "form" ? <FormView flow={flow} /> : null}

        {phase.name === "approve" ? (
          <Progress testId="sell-approving">
            {phase.step === "sign"
              ? `Approve ${phase.plan.symbol} in your wallet. This approves exactly ${tokensText(phase.plan.approve?.amount ?? phase.plan.tokensIn, phase.plan.symbol)}.`
              : "Approving… waiting for BNB Smart Chain to confirm."}
          </Progress>
        ) : null}

        {phase.name === "signing" ? (
          <Progress testId="sell-signing">{STATUS_LINE.signing}</Progress>
        ) : null}

        {phase.name === "mining" ? (
          <>
            <Progress testId="sell-mining">
              Sent. Waiting for BNB Smart Chain to confirm.
              {phase.slow ? " This is taking longer than usual; your transaction is saved." : ""}
            </Progress>
            <HashLink hash={phase.hash} />
            {phase.slow ? (
              <Button variant="glassy" onClick={flow.close}>
                Close
              </Button>
            ) : null}
          </>
        ) : null}

        {phase.name === "confirmed" ? (
          <>
            <div className="field" data-testid="sell-confirmed">
              <p className="flex items-center gap-2 font-semibold">
                <span
                  className="grid h-7 w-7 place-items-center rounded-full bg-up/20 text-up"
                  aria-hidden
                >
                  <Check size={16} />
                </span>
                Confirmed on-chain
              </p>
              <p className="mt-2 text-[15px] text-fg2">
                Confirmed on-chain. Check your USDT balance; reconciled sell receipts are coming.
              </p>
              <dl className="mt-3">
                {phase.blockNumber !== null ? (
                  <div className="detail-row">
                    <dt>Block</dt>
                    <dd>{phase.blockNumber.toLocaleString("en-US")}</dd>
                  </div>
                ) : null}
                {phase.feeUsd !== null ? (
                  <div className="detail-row">
                    <dt>Network fee</dt>
                    <dd data-testid="sell-fee" data-gas-used={phase.gasUsed ?? undefined}>
                      ≈ {fmtUsd(phase.feeUsd, 3)}
                      {phase.gasUsed !== null ? (
                        <span className="sr-only"> ({phase.gasUsed} gas units)</span>
                      ) : null}
                    </dd>
                  </div>
                ) : phase.gasUsed !== null ? (
                  <div className="detail-row">
                    <dt>Gas used</dt>
                    <dd data-testid="sell-fee" data-gas-used={phase.gasUsed}>
                      {phase.gasUsed.toLocaleString("en-US")} gas units
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
            <HashLink hash={phase.hash} href={phase.bscscan} />
            <Button onClick={flow.close}>Done</Button>
          </>
        ) : null}

        {phase.name === "failed" ? (
          <>
            <Notice tone="red" testId="sell-failed">
              {phase.failure.message}
            </Notice>
            {phase.hash ? <HashLink hash={phase.hash} href={phase.bscscan} /> : null}
            <Button variant="glassy" onClick={flow.close}>
              Close
            </Button>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function FormView({ flow }: { flow: Flow }) {
  const { phase, inputs, target } = flow;
  const plan = phase.name === "form" ? phase.plan : null;
  if (phase.name !== "form" || !target) return null;
  const view = plan ? toSellSheet(plan) : null;
  const busy = phase.refreshing;
  // The whole holding in shares, as the Portfolio shows it. Only the slider's scale: "Sell all" always sends the exact raw balance.
  const heldShares = target.probeShares;
  const typed = parseShares(inputs.text);
  const percent = inputs.all
    ? 100
    : heldShares > 0 && typed !== null
      ? Math.min(100, (typed / heldShares) * 100)
      : 0;
  const held = heldShares > 0 ? String(Math.floor(heldShares * 1e8) / 1e8) : "";
  const onPercent = (p: number) => {
    if (p >= 100) return flow.sellAll();
    if (p <= 0) return flow.setInputs({ all: false, text: "" });
    flow.setInputs({ all: false, text: String(Math.floor(((heldShares * p) / 100) * 1e8) / 1e8) });
  };

  return (
    <>
      <div className="field">
        <label htmlFor="sell-shares" className="t-meta">
          Shares to sell
        </label>
        <div className="mt-2 flex items-center gap-2">
          <input
            id="sell-shares"
            className="input num"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.025"
            value={inputs.all ? (view ? sharesText(view.sharesIn) : held) : inputs.text}
            onChange={(e) => {
              const v = e.target.value.replace(",", ".");
              if (/^\d*\.?\d{0,8}$/.test(v)) flow.setInputs({ text: v, all: false });
            }}
            data-testid="sell-shares"
          />
          <Button
            variant={inputs.all ? "primary" : "glassy"}
            type="button"
            aria-pressed={inputs.all}
            onClick={() => (inputs.all ? flow.setInputs({ all: false, text: "" }) : flow.sellAll())}
            data-testid="sell-all"
          >
            {inputs.all ? "Selling all" : "Sell all"}
          </Button>
        </div>
      </div>

      <PercentSlider
        value={percent}
        onChange={onPercent}
        label={target.symbol}
        available={heldShares > 0 ? `${fmtShares(heldShares)} shares in your wallet` : undefined}
        disabled={heldShares <= 0}
        testId="sell-slider"
      />

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="t-meta">Slippage</span>
        <Segmented
          label="Slippage"
          value={String(inputs.tolerancePct)}
          onChange={(v) => flow.setInputs({ tolerancePct: Number(v) })}
          options={SELL_TOLERANCES.map((t) => ({ value: String(t), label: `${t}%` }))}
        />
      </div>

      <div aria-live="polite" className="min-h-[20px]">
        {busy ? (
          <p className="t-meta flex items-center gap-2" data-testid="sell-refreshing">
            <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />{" "}
            {plan ? "Refreshing the quote…" : "Getting a quote…"}
          </p>
        ) : null}
      </div>

      {phase.notice ? (
        <Notice tone="amber" testId="sell-notice">
          {phase.notice}
        </Notice>
      ) : null}
      {phase.failure ? (
        <Notice tone="red" testId="sell-error">
          {phase.failure.message}
        </Notice>
      ) : null}

      {view ? (
        <div data-testid="sell-plan" data-status={view.status}>
          <dl>
            <div className="detail-row">
              <dt>You send</dt>
              <dd data-testid="sell-sends">
                {sharesText(view.sharesIn)} shares ({tokensText(view.tokensIn, view.symbol)})
              </dd>
            </div>
            <div className="detail-row">
              <dt>Expected</dt>
              <dd data-testid="sell-expected">{usdtText(view.expectedUsdt)}</dd>
            </div>
            <div className="detail-row">
              <dt>
                Least you receive
                <span className="block text-[13px] font-normal text-fg3">set by the router</span>
              </dt>
              <dd data-testid="sell-min">{usdtText(view.minUsdt)}</dd>
            </div>
            <div className="detail-row">
              <dt>Route</dt>
              <dd className="max-w-[60%]">
                {view.routeText} · {view.vendor}
              </dd>
            </div>
            {view.feeUsd !== null ? (
              <div className="detail-row">
                <dt>Network fee (estimated)</dt>
                <dd>≈ {fmtUsd(view.feeUsd, 3)}</dd>
              </div>
            ) : null}
          </dl>

          {view.warnings.length > 0 ? (
            <ul className="t-meta m-0 mt-3 list-disc pl-5" data-testid="sell-warnings">
              {view.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}

          {view.status === "needs_funds" ? (
            <Notice tone="amber" testId="sell-needs-funds">
              {view.shortfall?.tokens
                ? `This wallet is short by ${tokensText(view.shortfall.tokens, view.symbol)} for this amount.`
                : null}
              {view.shortfall?.tokens && view.shortfall?.bnb ? " " : null}
              {view.shortfall?.bnb
                ? `It also needs ${bnbText(view.shortfall.bnb)} more BNB for network fees.`
                : null}
            </Notice>
          ) : null}

          {view.status === "needs_approval" ? (
            <p className="t-meta mt-3" data-testid="sell-needs-approval">
              The route needs permission to move this amount of {view.symbol}. The approval is for{" "}
              exactly {tokensText(view.tokensIn, view.symbol)}, not unlimited.
            </p>
          ) : null}

          <p className="t-meta mt-3" data-testid="sell-auto-refresh">
            Quotes refresh automatically every 15s
          </p>
        </div>
      ) : null}

      {view?.next === "approve" ? (
        <Button big disabled={busy} onClick={() => void flow.approve()} data-testid="sell-approve">
          <ShieldCheck size={18} aria-hidden /> Approve {view.symbol}
        </Button>
      ) : null}
      {view?.next === "confirm" ? (
        <Button big disabled={busy} onClick={() => void flow.confirm()} data-testid="sell-confirm">
          Confirm sale
        </Button>
      ) : null}
      {view?.next === "fund" ? (
        <Button big disabled data-testid="sell-needs-funds-button">
          Not enough to sell this amount
        </Button>
      ) : null}
      {!view && !busy && !phase.failure ? (
        <p className="t-meta">Enter a number of shares, or choose Sell all.</p>
      ) : null}

      <p className="t-meta" data-testid="sell-risk">
        Tokenized shares can sell for less than the US price. The router enforces the least USDT
        shown: if the price moves past it, the sale doesn&apos;t happen and only the network fee is
        spent.
      </p>
    </>
  );
}

function Notice({
  tone,
  children,
  testId,
}: {
  tone: "red" | "amber";
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      role={tone === "red" ? "alert" : "status"}
      data-testid={testId}
      className={
        tone === "red"
          ? "flex gap-3 rounded-[14px] border border-[rgba(255,107,107,.35)] bg-[rgba(255,107,107,.08)] p-4 text-[15px]"
          : "flex gap-3 rounded-[14px] bg-[rgba(242,193,78,.1)] p-4 text-[15px] text-amber"
      }
    >
      <AlertTriangle size={18} className="mt-0.5 flex-none" aria-hidden />
      <p className="min-w-0 flex-1">{children}</p>
    </div>
  );
}

function Progress({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div role="status" aria-live="polite" className="field" data-testid={testId}>
      <p className="flex items-start gap-3 text-[15px]">
        <Loader2
          size={18}
          className="mt-0.5 flex-none animate-spin motion-reduce:animate-none"
          aria-hidden
        />
        <span>{children}</span>
      </p>
    </div>
  );
}

function HashLink({ hash, href }: { hash: string; href?: string }) {
  return (
    <a
      className="btn btn-glassy"
      href={href ?? `https://bscscan.com/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      aria-label="View transaction on BscScan (opens in a new tab)"
      data-testid="sell-hash"
    >
      <ExternalLink size={16} aria-hidden /> BscScan{" "}
      <span className="mono text-[13px] text-fg2">{shortHash(hash)}</span>
    </a>
  );
}
