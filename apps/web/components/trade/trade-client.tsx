"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { LiveText } from "@/components/motion/live";
import { Button } from "@/components/motion/button";
import { useTallyWallet } from "@/components/wallet/wallet-context";
import { useJson } from "@/lib/hooks/use-json";
import { useModuleFlags } from "@/lib/hooks/use-flags";
import type { PortfolioReport } from "@tally/engine";
import { SellSheet } from "./sell-sheet";
import { useSellFlow } from "./use-sell-flow";
import { useLiveQuote, type QuoteAmount } from "@/lib/hooks/use-live-quote";
import { fmtUsd, SESSION_LABEL } from "@/lib/format";
import { isBuyable, nameOf, tokenPair } from "@/lib/tickers";
import { ComingSoon } from "./coming-soon";
import { StockPicker } from "./stock-picker";
import { SessionBadge } from "./badges";
import { TradeFlowLayer, flowActionLabel } from "./flow-host";
import { IssuerList } from "./issuer-list";
import { Sparkline } from "./sparkline";
import { MIN_USD, TradeCard, type Unit } from "./trade-card";
import { useTradeFlow, type FlowParams } from "./use-trade-flow";

export function TradeClient(props: { ticker: string; initialUsd?: number }) {
  return <TradeInner {...props} />;
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

function TradeInner({
  ticker: initialTicker,
  initialUsd,
}: {
  ticker: string;
  initialUsd?: number;
}) {
  const [ticker, setTicker] = useState(initialTicker);
  const name = nameOf(ticker);
  const buyable = isBuyable(ticker);
  const wallet = useTallyWallet();
  const [unit, setUnit] = useState<Unit>("usd");
  const [amountText, setAmountText] = useState(
    String(initialUsd && initialUsd >= MIN_USD ? initialUsd : MIN_USD),
  );
  const [tolerance, setTolerance] = useState(1);
  const [picked, setPicked] = useState<string | undefined>();
  const flow = useTradeFlow();
  const { phase } = flow;
  // Buying and selling share this card; the flip button between its two boxes swaps them. Selling is behind the server's sell flag.
  const flags = useModuleFlags();
  const sellOn = flags.sell === true;
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [sellText, setSellText] = useState("");
  const sellFlow = useSellFlow();
  const portfolio = useJson<PortfolioReport>(
    wallet.authenticated && wallet.address ? `/api/portfolio?address=${wallet.address}` : null,
    { refreshMs: 10_000 },
  );
  // The largest Ondo or bStock position in this stock: that is the token a sale would use.
  const holding = useMemo(() => {
    const parts = portfolio.data?.groups.find((g) => g.ticker === ticker)?.parts ?? [];
    return parts
      .filter((x) => x.issuer === "ondo" || x.issuer === "bstock")
      .sort((a, b) => b.shares - a.shares)[0];
  }, [portfolio.data, ticker]);

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
    // Priced at once from the row's price per share, so the dollar value follows every keystroke; the quote then refines it.
    const usd =
      row?.usdPerShare !== undefined && amount > 0 ? amount * row.usdPerShare : row?.amountUsd;
    if (usd === undefined) return null;
    return Math.max(MIN_USD, Math.ceil(usd * 100) / 100);
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
    flow.start(p);
  };

  const onSell = () => {
    if (!wallet.authenticated) return wallet.login();
    if (!holding) return;
    void sellFlow.open(
      {
        ticker,
        issuer: holding.issuer as "ondo" | "bstock",
        symbol: holding.symbol,
        probeShares: holding.shares,
        probeUsd: holding.valueUsd,
      },
      sellText || undefined,
    );
  };

  const best = q?.rows.find((r) => r.isBest);

  const changeTicker = (t: string) => {
    if (t === ticker) return;
    history.current = [];
    setPoints([]);
    setPicked(undefined);
    setSellText("");
    setTicker(t);
    flow.cancel();
    try {
      window.history.replaceState(null, "", `/trade/${t}`);
    } catch {
      /* the URL just stays as it was */
    }
  };

  return (
    <main id="main" className="wrap pb-24 pt-8 min-[561px]:pt-12">
      <TradeFlowLayer flow={flow} />
      {sellOn ? <SellSheet flow={sellFlow} /> : null}
      <div className="flex flex-col gap-4 min-[981px]:grid min-[981px]:grid-cols-[minmax(0,480px)_minmax(0,1fr)] min-[981px]:items-start min-[981px]:gap-8">
        {/* Right on desktop: the stock, its price, then the issuers compared (the trade card is on the left). On a phone the trade card comes second. */}
        <div className="contents min-[981px]:col-start-2 min-[981px]:row-start-1 min-[981px]:grid min-[981px]:min-w-0 min-[981px]:grid-cols-1 min-[981px]:gap-4">
          <div className="order-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <StockPicker value={ticker} onChange={changeTicker} />
              {q ? <SessionBadge session={q.session} /> : null}
            </div>
            <h1 className="t-h2 mt-4 !text-[clamp(31px,5vw,45px)]">{name}</h1>
            <p className="t-meta mono" data-testid="top-symbol">
              <LiveText text={best?.symbol ?? tokenPair(ticker)} /> · tokenized, not the underlying
              share
            </p>
          </div>

          <div className="glass order-2 min-w-0 p-5">
            <p className="t-meta">Price</p>
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
            <p className="t-meta mt-1">Updates every 10s</p>
          </div>

          <div className="order-4 min-w-0">
            <IssuerList
              quote={q}
              selected={row?.symbol}
              onSelect={setPicked}
              loading={quote.loading}
            />
          </div>

          <div className="panel order-5 min-w-0 p-5">
            <p className="flex items-center gap-2 font-semibold">
              <ShieldCheck size={18} aria-hidden /> Guaranteed in shares, on-chain
            </p>
            <p className="mt-1 text-[15px] text-fg2">
              Tally checks how many <b className="text-fg">shares</b> your tokens represent and
              cancels the whole trade if you&apos;d get fewer than your minimum. Your USDT stays
              put. These are tokenized shares issued by Ondo and bStocks, not the underlying stock.
            </p>
          </div>
          {!buyable ? (
            <p role="status" className="order-5 text-[15px] text-amber">
              {tokenPair(ticker)} can be compared here, but buying isn&apos;t switched on yet.
            </p>
          ) : null}
          <p className="sr-only" aria-live="polite" data-testid="live-summary">
            {best && q
              ? `${best.symbol} is best now at ${fmtUsd(best.usdPerShare)} per share. ${SESSION_LABEL[q.session] ?? ""}`
              : ""}
          </p>
        </div>

        <div className="contents min-[981px]:col-start-1 min-[981px]:row-start-1 min-[981px]:grid min-[981px]:min-w-0 min-[981px]:grid-cols-1 min-[981px]:gap-4">
          <div className="order-3 grid min-w-0 grid-cols-1 gap-4">
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
                      className="mono mt-1 inline-block text-[13.5px] text-blue"
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
              phaseLabel={
                wallet.authenticated && phase.name !== "idle"
                  ? flowActionLabel(phase, "")
                  : undefined
              }
              quoteLoading={quote.loading}
              onBuy={onBuy}
              mode={mode}
              onFlip={() => setMode((m) => (m === "buy" ? "sell" : "buy"))}
              flipEnabled={sellOn}
              usdtBalance={portfolio.data?.wallet.usdt ?? null}
              sell={{
                text: sellText,
                onText: setSellText,
                heldShares: holding?.shares ?? 0,
                symbol: holding?.symbol,
                usdOut:
                  row?.usdPerShare !== undefined && Number(sellText) > 0
                    ? Number(sellText) * row.usdPerShare
                    : null,
                onSell: onSell,
              }}
            />
            {quote.error && !q ? (
              <p role="alert" className="text-[15px] text-amber" data-testid="quote-error">
                {quote.error.message}
              </p>
            ) : null}
            <ComingSoon items={["Limit price", "Recurring buys"]} title="Advanced · coming soon" />
          </div>
        </div>
      </div>
    </main>
  );
}
