"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Button, ButtonLink } from "@/components/motion/button";
import { Segmented } from "@/components/motion/segmented";
import { ActionLabel, TradeFlowLayer, flowActionLabel } from "@/components/trade/flow-host";
import { useTradeFlow, type FlowParams } from "@/components/trade/use-trade-flow";
import { IssuerList } from "@/components/trade/issuer-list";
import { ComingSoon } from "@/components/trade/coming-soon";
import { StockPicker } from "@/components/trade/stock-picker";
import { useTallyWallet } from "@/components/wallet/wallet-context";
import { HoldingGroup, EXAMPLE_GROUP } from "@/components/portfolio/portfolio";
import { RadarRowCard, RadarStats, useRadar } from "@/components/radar/radar";
import type { QuoteDto } from "@/lib/dto";
import { ISSUER_LABEL, fmtShares, fmtUsd } from "@/lib/format";
import { useJson } from "@/lib/hooks/use-json";
import { useLiveQuote } from "@/lib/hooks/use-live-quote";
import { BUYABLE_TICKERS, isBuyable, tokenPair, tokenSymbol } from "@/lib/tickers";
import type { PortfolioReport } from "@tally/engine";
import { LiveUsd } from "@/components/motion/live";

/* ----------------------------------------------------------------- hero card */

/** The minimalist trade card on Home: pick a stock, type dollars, see the best live price. The real flow lives on /trade. */
export function HomeTradeCard() {
  const wallet = useTallyWallet();
  const flow = useTradeFlow();
  const { phase } = flow;
  const [ticker, setTicker] = useState("NVDA");
  const [text, setText] = useState("6");
  const usd = Number(text);
  const q = useLiveQuote(ticker, usd >= 6 ? { usd } : null, phase.name === "review");
  const row = q.data?.rows.find((r) => r.isBest) ?? q.data?.rows.find((r) => r.executable);
  const tooSmall = text !== "" && usd < 6;
  const href = `/trade/${ticker}?usd=${usd >= 6 ? usd : 6}`;
  const busy = phase.name !== "idle" && phase.name !== "error" && phase.name !== "done";
  // Follows the best issuer for the chosen stock (NVDAon, NVDAB…), never a bare ticker.
  const symbol = row?.symbol ?? tokenSymbol(ticker, "ondo");
  const idleLabel = `Buy ${symbol}`;
  const canBuy =
    !!row?.executable &&
    usd >= 6 &&
    (row.issuer === "ondo" || row.issuer === "bstock") &&
    isBuyable(ticker);

  const buy = () => {
    if (!row || (row.issuer !== "ondo" && row.issuer !== "bstock")) return;
    const p: FlowParams = { ticker, issuer: row.issuer, symbol: row.symbol, usd, tolerancePct: 1 };
    flow.start(p);
  };

  return (
    <section className="gcard w-full" aria-label="Quick quote" data-testid="home-card">
      <TradeFlowLayer flow={flow} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StockPicker value={ticker} onChange={setTicker} />
        <span className="limit-chip">Min $6</span>
      </div>
      <div className="field mt-4">
        <label htmlFor="home-amount" className="t-meta">
          You pay
        </label>
        <div className="mt-2 flex items-center gap-1">
          <span className="text-[clamp(37px,5vw,57px)] font-bold leading-none text-fg3">$</span>
          <input
            id="home-amount"
            className="amount-input"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            aria-invalid={tooSmall}
            onChange={(e) => {
              const v = e.target.value.replace(",", ".");
              if (/^\d*\.?\d{0,2}$/.test(v)) setText(v);
            }}
          />
        </div>
        <p className="mt-2 min-h-[20px] text-[14px] text-red" role={tooSmall ? "alert" : undefined}>
          {tooSmall ? "Minimum is $6." : ""}
        </p>
      </div>
      <div className="field mt-2" data-testid="home-get">
        <p className="t-meta">You get, at the best price right now</p>
        <p className="t-big mt-2 !text-[clamp(31px,3.6vw,47px)]">
          {row?.shares === undefined ? (
            <span className="text-fg-disabled">–</span>
          ) : (
            <>
              <AnimatedNumber
                value={row.shares}
                decimals={row.shares >= 1 ? 4 : 6}
                startOnView={false}
                duration={0.5}
              />{" "}
              <span className="text-[21px] text-fg2">{symbol} shares</span>
            </>
          )}
        </p>
      </div>
      <div className="mt-3">
        {wallet.authenticated ? (
          // Signed in: the button is the transaction. It says what is happening (price, approve, confirm, buying, done).
          <Button
            big
            disabled={busy || (phase.name === "idle" && !canBuy)}
            onClick={buy}
            className="trade-cta"
            data-testid="home-action"
          >
            <ActionLabel text={flowActionLabel(phase, idleLabel)} />
          </Button>
        ) : (
          <ButtonLink
            href={href}
            big
            aria-disabled={tooSmall || !isBuyable(ticker)}
            className="trade-cta"
            data-testid="home-action"
          >
            <ActionLabel text={idleLabel} /> <ArrowRight size={16} aria-hidden />
          </ButtonLink>
        )}
      </div>
      {row ? (
        // One line under the button: issuer, price per share and fee. Flex with centred items keeps the rolling number level with the text.
        <p
          className="mt-3 flex items-center justify-center gap-x-1.5 whitespace-nowrap text-[13px] text-fg2 min-[400px]:text-[14.5px]"
          data-testid="home-route"
        >
          <span>{ISSUER_LABEL[row.issuer]}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <LiveUsd value={row.usdPerShare} /> per share
          </span>
          {row.feeUsd === undefined ? null : (
            <>
              <span aria-hidden>·</span>
              <span>fee ≈ {fmtUsd(row.feeUsd, 3)}</span>
            </>
          )}
        </p>
      ) : null}
      {phase.name === "error" ? (
        <p role="alert" className="mt-3 text-[14.5px] text-red" data-testid="home-error">
          {phase.message}
        </p>
      ) : null}
      <div className="mt-3">
        <ComingSoon
          title="Coming soon"
          items={
            flags?.switch === true
              ? ["Sell to USDT", "Sell to BNB"]
              : ["Sell to USDT", "Sell to BNB", "Migrate between issuers"]
          }
        />
      </div>
      <p className="t-meta mt-3">
        Tokenized shares track a US stock&apos;s price. They are not the underlying shares.
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------- trade part */

export function UnitTrapCard() {
  const [view, setView] = useState<"token" | "share">("token");
  const perShare = view === "share";
  return (
    <div className="gcard">
      <Segmented
        label="Show price as"
        value={view}
        onChange={setView}
        options={[
          { value: "token", label: "Price per token" },
          { value: "share", label: "Price per share" },
        ]}
      />
      <dl className="mt-4">
        <div className="detail-row">
          <dt>Ondo NFLXon (10 shares per token)</dt>
          <dd className="num">{perShare ? "$68.08" : "$680.80"}</dd>
        </div>
        <div className="detail-row">
          <dt>bStock NFLXB (1 share per token)</dt>
          <dd className="num">$68.15</dd>
        </div>
      </dl>
      <p className="t-meta mt-3" aria-live="polite">
        {perShare
          ? "Per share they differ by about 0.1%. That's the real comparison."
          : "Compared per token, Ondo looks 899% dearer. It isn't: one token is ten shares."}
      </p>
      <p className="t-meta mt-1">Recorded 2026-10-02.</p>
    </div>
  );
}

export function TickerStrip() {
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const t of BUYABLE_TICKERS) {
        try {
          const r = await fetch(`/api/quote?ticker=${t.ticker}&usd=6`);
          if (!r.ok) continue;
          const q = (await r.json()) as QuoteDto;
          if (live) setPrices((p) => ({ ...p, [t.ticker]: q.referencePrice }));
        } catch {
          /* leave this one blank */
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return (
    <ul className="m-0 flex list-none flex-wrap gap-3 p-0" aria-label="Stocks you can buy">
      {BUYABLE_TICKERS.map((t) => (
        <li key={t.ticker}>
          <Link
            href={`/trade/${t.ticker}`}
            className="panel flex min-h-[44px] items-center gap-3 px-4 text-fg no-underline"
          >
            <span className="font-semibold">{tokenPair(t.ticker)}</span>
            <span className="num text-fg2">
              {prices[t.ticker] ? <LiveUsd value={prices[t.ticker]} /> : "…"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The live comparison for the Trade section: the same list as the trade page, for any of the five stocks. */
export function HomeComparison() {
  const [ticker, setTicker] = useState("NVDA");
  const q = useLiveQuote(ticker, { usd: 25 });
  return (
    <div data-testid="home-comparison">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="t-h3 !text-[19px]">Live comparison</h3>
        <StockPicker value={ticker} onChange={setTicker} className="!w-[min(100%,230px)]" />
      </div>
      <IssuerList
        quote={q.data?.ticker === ticker ? q.data : null}
        selected={q.data?.best}
        onSelect={() => undefined}
        loading={q.loading}
        showTitle={false}
      />
      {q.error && !q.data ? (
        <p role="alert" className="mt-3 text-[15px] text-amber">
          {q.error.message}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- portfolio part */

export function HomePortfolioPreview() {
  const wallet = useTallyWallet();
  const address = wallet.authenticated ? wallet.address : undefined;
  const { data } = useJson<PortfolioReport>(address ? `/api/portfolio?address=${address}` : null, {
    refreshMs: 15_000,
  });
  if (address && data && data.groups.length > 0)
    return (
      <div>
        <p className="t-meta mb-2">Your holdings right now</p>
        <ul className="m-0 grid list-none gap-3 p-0">
          {data.groups.slice(0, 2).map((g) => (
            <HoldingGroup key={g.ticker} g={g} />
          ))}
        </ul>
      </div>
    );
  return (
    <div>
      <p className="t-meta mb-2">Example: the two recorded test buys (not a real account)</p>
      <ul className="m-0 grid list-none gap-3 p-0">
        <HoldingGroup g={EXAMPLE_GROUP} example />
      </ul>
    </div>
  );
}

/* ----------------------------------------------------------------- radar part */

export function HomeRadarPreview() {
  const { data, error } = useRadar();
  const worst = data
    ? [...data.rows]
        .filter((r) => r.grade !== "A" && r.grade !== "B")
        .sort((a, b) => "FDCBA".indexOf(a.grade) - "FDCBA".indexOf(b.grade))
        .slice(0, 4)
    : [];
  return (
    <div data-testid="home-radar">
      {data ? (
        <RadarStats rows={data.rows} />
      ) : (
        <div className="skeleton h-[96px]" aria-busy="true" />
      )}
      <p className="t-meta mb-2 mt-5">Flagged right now</p>
      {error && !data ? <p className="text-amber">{error}</p> : null}
      <ul className="m-0 grid list-none gap-3 p-0">
        {!data
          ? [0, 1].map((i) => <li key={i} className="skeleton h-[110px]" />)
          : worst.map((r) => <RadarRowCard key={r.address} r={r} />)}
      </ul>
      {data && worst.length === 0 ? (
        <p className="flex items-center gap-2 text-fg2">
          <Check size={16} className="text-up" aria-hidden /> Nothing flagged in the tokens checked.
        </p>
      ) : null}
    </div>
  );
}

export { fmtShares };
