"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { ButtonLink } from "@/components/motion/button";
import { IssuerList } from "@/components/trade/issuer-list";
import { ComingSoon } from "@/components/trade/coming-soon";
import { StockPicker } from "@/components/trade/stock-picker";
import { useTallyWallet } from "@/components/wallet/wallet-context";
import { HoldingGroup, EXAMPLE_GROUP } from "@/components/portfolio/portfolio";
import { RadarRowCard, RadarStats, useRadar } from "@/components/radar/radar";
import type { QuoteDto } from "@/lib/dto";
import { ISSUER_LABEL, fmtPct, fmtShares, fmtUsd } from "@/lib/format";
import { useJson } from "@/lib/hooks/use-json";
import { useLiveQuote } from "@/lib/hooks/use-live-quote";
import { BUYABLE_TICKERS, isBuyable } from "@/lib/tickers";
import type { PortfolioReport } from "@tally/engine";

/* ----------------------------------------------------------------- hero card */

/** The minimalist trade card on Home: pick a stock, type dollars, see the best live price. The real flow lives on /trade. */
export function HomeTradeCard() {
  const [ticker, setTicker] = useState("NVDA");
  const [text, setText] = useState("6");
  const usd = Number(text);
  const q = useLiveQuote(ticker, usd >= 6 ? { usd } : null);
  const row = q.data?.rows.find((r) => r.isBest) ?? q.data?.rows.find((r) => r.executable);
  const tooSmall = text !== "" && usd < 6;
  const href = `/trade/${ticker}?usd=${usd >= 6 ? usd : 6}`;
  return (
    <section className="gcard w-full" aria-label="Quick quote" data-testid="home-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StockPicker value={ticker} onChange={setTicker} id="home-stock" />
        <span className="limit-chip">Min $6</span>
      </div>
      <div className="field mt-4">
        <label htmlFor="home-amount" className="t-meta">
          You pay
        </label>
        <div className="mt-2 flex items-center gap-1">
          <span className="text-[clamp(36px,5vw,56px)] font-bold leading-none text-fg3">$</span>
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
        <p className="mt-2 min-h-[20px] text-[13px] text-red" role={tooSmall ? "alert" : undefined}>
          {tooSmall ? "Minimum is $6." : ""}
        </p>
      </div>
      <div className="field mt-2" data-testid="home-get">
        <p className="t-meta">You get, at the best price right now</p>
        <p className="t-big mt-2 !text-[clamp(30px,3.6vw,46px)]">
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
              <span className="text-[20px] text-fg2">{ticker} shares</span>
            </>
          )}
        </p>
        {row ? (
          <p className="mt-2 text-[13.5px] text-fg2">
            via {ISSUER_LABEL[row.issuer]} · {fmtUsd(row.usdPerShare)} per share ·{" "}
            <span className={row.premium! < 0 ? "pos" : "neg"}>
              {row.premium! < 0 ? "▼ " : "▲ "}
              {fmtPct(row.premium)} vs US
            </span>
            {row.feeUsd === undefined ? "" : ` · fee ≈ ${fmtUsd(row.feeUsd, 3)}`}
          </p>
        ) : null}
      </div>
      <div className="mt-4">
        <ButtonLink href={href} big aria-disabled={tooSmall || !isBuyable(ticker)}>
          Get Started <ArrowRight size={16} aria-hidden />
        </ButtonLink>
      </div>
      <div className="mt-3">
        <ComingSoon title="Swap out" items={["Sell to USDT", "Sell to BNB"]} />
      </div>
      <p className="t-meta mt-3">
        Tokenized shares track a US stock&apos;s price. They are not the underlying shares.
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------- trade part */

export function UnitTrapCard() {
  const [perShare, setPerShare] = useState(false);
  return (
    <div className="gcard">
      <div
        role="group"
        aria-label="Show price as"
        className="inline-flex gap-1 rounded-full border border-[var(--edge)] bg-white/[0.05] p-1"
      >
        {(
          [
            [false, "Price per token"],
            [true, "Price per share"],
          ] as const
        ).map(([v, l]) => (
          <button
            key={l}
            type="button"
            aria-pressed={perShare === v}
            onClick={() => setPerShare(v)}
            className={`min-h-[36px] rounded-full px-4 text-[14px] font-semibold ${perShare === v ? "bg-[var(--silver)] text-[var(--silver-ink)]" : "text-fg2"}`}
          >
            {l}
          </button>
        ))}
      </div>
      <dl className="mt-4">
        <div className="detail-row">
          <dt>Ondo NFLX (10 shares per token)</dt>
          <dd className="num">{perShare ? "$68.08" : "$680.80"}</dd>
        </div>
        <div className="detail-row">
          <dt>bStock NFLX (1 share per token)</dt>
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
            <span className="font-semibold">{t.ticker}</span>
            <span className="num text-fg2">
              {prices[t.ticker] ? fmtUsd(prices[t.ticker]) : "…"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The live comparison for the Trade section: the same list as the trade page, with a $25 example. */
export function HomeComparison() {
  const q = useLiveQuote("NVDA", { usd: 25 });
  return (
    <div data-testid="home-comparison">
      <IssuerList
        quote={q.data}
        selected={q.data?.best}
        onSelect={() => undefined}
        loading={q.loading}
      />
      {q.error && !q.data ? (
        <p role="alert" className="mt-3 text-[14px] text-amber">
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
  const { data } = useJson<PortfolioReport>(address ? `/api/portfolio?address=${address}` : null);
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
