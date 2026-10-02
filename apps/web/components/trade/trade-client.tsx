"use client";

import { AlertTriangle, ExternalLink, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Button } from "@/components/motion/button";
import { WalletRoot, useTallyWallet } from "@/components/wallet/wallet-context";
import { SHAREGUARD_DEPLOYED } from "@tally/config";
import { useLiveQuote, type QuoteAmount } from "@/lib/hooks/use-live-quote";
import { fmtUsd, SESSION_LABEL } from "@/lib/format";
import { SessionBadge, TokenLogo } from "./badges";
import { ProgressIsland, ReceiptCard, ReviewSheet, SignInSheet, TopUpSheet } from "./flow-sheets";
import { IssuerList } from "./issuer-list";
import { Sparkline } from "./sparkline";
import { MIN_USD, TradeCard, type Unit } from "./trade-card";
import { useTradeFlow, type FlowParams } from "./use-trade-flow";

export function TradeClient(props: { ticker: string; name: string; buyable: boolean }) {
  return (
    <WalletRoot>
      <TradeInner {...props} />
    </WalletRoot>
  );
}

const RETRY_KINDS = new Set([
  "price_moved",
  "expired",
  "feed_stale",
  "route_failed",
  "simulation_reverted",
  "quotes_unavailable",
  "upstream",
  "busy",
  "approve_failed",
  "timeout",
]);

function TradeInner({ ticker, name, buyable }: { ticker: string; name: string; buyable: boolean }) {
  const wallet = useTallyWallet();
  const [unit, setUnit] = useState<Unit>("usd");
  const [amountText, setAmountText] = useState(String(MIN_USD));
  const [tolerance, setTolerance] = useState(1);
  const [picked, setPicked] = useState<string | undefined>();
  const [dismissed, setDismissed] = useState(false);
  const flow = useTradeFlow();
  const { phase } = flow;

  const amount = Number(amountText);
  const quoteAmount = useMemo<QuoteAmount | null>(() => {
    if (!(amount > 0)) return null;
    return unit === "usd" ? (amount >= MIN_USD ? { usd: amount } : null) : { shares: amount };
  }, [amount, unit]);
  // The confirm step must never move under the user's finger (DESIGN §3.3).
  const quote = useLiveQuote(ticker, quoteAmount, phase.name === "review");
  const q = quote.data;

  const row = useMemo(() => {
    if (!q) return undefined;
    return (
      q.rows.find((r) => r.symbol === picked && r.executable) ??
      q.rows.find((r) => r.isBest) ??
      q.rows.find((r) => r.executable) ??
      q.rows[0]
    );
  }, [q, picked]);

  const spendUsd = useMemo(() => {
    if (unit === "usd") return amount >= MIN_USD ? amount : null;
    if (row?.amountUsd === undefined) return null;
    return Math.max(MIN_USD, Math.ceil(row.amountUsd * 100) / 100);
  }, [unit, amount, row]);

  // Session price line, from our own polling.
  const history = useRef<number[]>([]);
  const [points, setPoints] = useState<number[]>([]);
  useEffect(() => {
    if (q?.referencePrice == null) return;
    history.current = [...history.current, q.referencePrice].slice(-60);
    setPoints(history.current);
  }, [q?.asOf, q?.referencePrice]);

  // Bring the outcome into view: on a phone the receipt or error sits above the fold's end.
  useEffect(() => {
    if (phase.name !== "done" && phase.name !== "error") return;
    const el = document.querySelector<HTMLElement>(
      '[data-testid="receipt"],[data-testid="flow-error"]',
    );
    el?.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [phase.name]);

  const busy = phase.name !== "idle" && phase.name !== "error" && phase.name !== "done";

  const onBuy = () => {
    if (!row || spendUsd === null || (row.issuer !== "ondo" && row.issuer !== "bstock")) return;
    const p: FlowParams = {
      ticker,
      issuer: row.issuer,
      symbol: row.symbol,
      usd: spendUsd,
      tolerancePct: tolerance,
    };
    setDismissed(false);
    flow.start(p);
  };

  const params = flow.params.current;
  const reviewPlan = phase.name === "review" ? phase.plan : null;
  const topupPlan = phase.name === "topup" ? phase.plan : null;
  const best = q?.rows.find((r) => r.isBest);

  return (
    <main id="main" className="wrap pb-24 pt-8 min-[561px]:pt-12">
      <ProgressIsland phase={phase} />
      <div className="flex flex-col gap-4 min-[981px]:grid min-[981px]:grid-cols-[minmax(0,1fr)_minmax(0,480px)] min-[981px]:items-start min-[981px]:gap-8">
        <div className="contents min-w-0 min-[981px]:block">
          <div className="order-1 min-w-0">
            <p className="eyebrow glass !rounded-full">
              <span className="dot-live" aria-hidden />
              <span>
                Compared across <b>Ondo · bStocks</b>
              </span>
            </p>
            <div className="mt-5 flex items-center gap-4">
              <TokenLogo ticker={ticker} />
              <div className="min-w-0">
                <h1 className="t-h2 !text-[clamp(30px,5vw,44px)]">{name}</h1>
                <p className="t-meta mono">{ticker}</p>
              </div>
              <div className="ml-auto">{q ? <SessionBadge session={q.session} /> : null}</div>
            </div>
          </div>

          <div className="glass order-3 mt-2 min-w-0 p-5 min-[981px]:mt-6">
            <p className="t-meta">US price per share</p>
            <p className="t-big mt-1" data-testid="ref-price">
              {q?.referencePrice == null ? (
                <span className="text-fg-disabled">–</span>
              ) : (
                <>
                  <span className="text-fg3">$</span>
                  <AnimatedNumber
                    value={q.referencePrice}
                    decimals={2}
                    startOnView={false}
                    duration={0.6}
                  />
                </>
              )}
            </p>
            <div className="mt-3">
              <Sparkline points={points} />
            </div>
            <p className="t-meta mt-1">This session · updates every 10 seconds</p>
          </div>

          <div className="panel order-4 mt-0 min-w-0 p-5 min-[981px]:mt-4">
            <p className="flex items-center gap-2 font-semibold">
              <ShieldCheck size={18} aria-hidden /> Guaranteed in shares, on-chain
            </p>
            <p className="mt-1 text-[14px] text-fg2">
              ShareGuard checks how many <b className="text-fg">shares</b> you receive, not tokens.
              If it&apos;s below your minimum, nothing happens and your USDT stays put.
            </p>
            <a
              className="mono mt-2 inline-flex items-center gap-1.5 text-[12.5px] text-blue"
              href={`https://bscscan.com/address/${SHAREGUARD_DEPLOYED}`}
              target="_blank"
              rel="noreferrer"
            >
              {SHAREGUARD_DEPLOYED.slice(0, 8)}…{SHAREGUARD_DEPLOYED.slice(-6)}{" "}
              <ExternalLink size={12} aria-hidden />
              <span className="sr-only">(opens BscScan in a new tab)</span>
            </a>
          </div>
          {!buyable ? (
            <p role="status" className="mt-4 text-[14px] text-amber">
              {ticker} can be compared here, but ShareGuard isn&apos;t set up for it yet, so buying
              is switched off.
            </p>
          ) : null}
          <p className="sr-only" aria-live="polite" data-testid="live-summary">
            {best && q
              ? `${ticker}: ${best.symbol} is best now at ${fmtUsd(best.usdPerShare)} per share. ${SESSION_LABEL[q.session] ?? ""}`
              : ""}
          </p>
        </div>

        <div className="contents min-w-0 min-[981px]:grid min-[981px]:grid-cols-1 min-[981px]:gap-4">
          <div className="order-2 grid min-w-0 grid-cols-1 gap-4">
            {phase.name === "done" && !dismissed ? (
              <ReceiptCard
                receipt={phase.receipt}
                plan={phase.plan}
                ticker={ticker}
                symbol={params?.symbol ?? row?.symbol ?? ticker}
                onDismiss={() => {
                  setDismissed(true);
                  flow.cancel();
                }}
              />
            ) : null}
            {phase.name === "error" ? (
              <div
                role="alert"
                className="panel flex gap-3 border-[rgba(255,107,107,.35)] p-4"
                data-testid="flow-error"
              >
                <AlertTriangle size={18} className="mt-0.5 flex-none text-red" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{phase.message}</p>
                  {phase.txHash ? (
                    <a
                      className="mono mt-1 inline-block text-[12.5px] text-blue"
                      href={`https://bscscan.com/tx/${phase.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on BscScan
                    </a>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {RETRY_KINDS.has(phase.kind) ? (
                      <Button onClick={() => void flow.run()}>Review new quote</Button>
                    ) : null}
                    <Button variant="glassy" onClick={flow.cancel}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
            <TradeCard
              ticker={ticker}
              unit={unit}
              onUnit={setUnit}
              amountText={amountText}
              onAmount={setAmountText}
              row={row}
              spendUsd={spendUsd}
              tolerance={tolerance}
              onTolerance={setTolerance}
              buyable={buyable}
              authenticated={wallet.authenticated}
              walletReady={wallet.ready}
              busy={busy}
              quoteLoading={quote.loading}
              onBuy={onBuy}
            />
          </div>
          {quote.error && !q ? (
            <p role="alert" className="order-2 text-[14px] text-amber" data-testid="quote-error">
              {quote.error.message}
            </p>
          ) : null}
          <div className="order-5 min-w-0">
            <IssuerList
              quote={q}
              selected={row?.symbol}
              onSelect={setPicked}
              loading={quote.loading}
            />
          </div>
        </div>
      </div>

      <SignInSheet open={phase.name === "signin"} onClose={flow.cancel} />
      {params ? (
        <TopUpSheet
          plan={topupPlan}
          params={params}
          onFunded={() => void flow.run()}
          onClose={flow.cancel}
        />
      ) : null}
      <ReviewSheet
        plan={reviewPlan}
        notice={phase.name === "review" ? phase.notice : undefined}
        onConfirm={() => void flow.confirm()}
        onClose={flow.cancel}
      />
    </main>
  );
}
