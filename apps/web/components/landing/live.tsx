"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { ButtonLink } from "@/components/motion/button";
import { IssuerList } from "@/components/trade/issuer-list";
import type { FillDto, QuoteDto } from "@/lib/dto";
import { useLiveQuote } from "@/lib/hooks/use-live-quote";
import { ISSUER_LABEL, fmtPct, fmtShares, fmtUsd } from "@/lib/format";
import { BUYABLE_TICKERS } from "@/lib/tickers";

const Ctx = createContext<{ quote: QuoteDto | null; loading: boolean; error: string | null }>({
  quote: null,
  loading: true,
  error: null,
});

/** One shared NVDA $6 quote for the hero card and the comparison preview (polled like the trade page). */
export function LandingQuote({ children }: { children: ReactNode }) {
  const q = useLiveQuote("NVDA", { usd: 6 });
  return (
    <Ctx.Provider value={{ quote: q.data, loading: q.loading, error: q.error?.message ?? null }}>
      {children}
    </Ctx.Provider>
  );
}

/** Hero floating card: a real live quote. While it loads it says so; it never shows invented numbers. */
export function HeroQuoteCard() {
  const { quote } = useContext(Ctx);
  const best = quote?.rows.find((r) => r.isBest);
  return (
    <div className="gcard relative z-10" data-testid="hero-quote">
      <p className="t-meta">
        NVDA · $6 · live quote{best ? ` · ${ISSUER_LABEL[best.issuer]}` : ""}
      </p>
      {best?.shares !== undefined ? (
        <>
          <p className="t-big mt-2">
            <AnimatedNumber value={best.shares} decimals={4} startOnView={false} duration={0.6} />{" "}
            <span className="text-2xl text-fg2">shares</span>
          </p>
          <p className="mt-2 text-sm text-fg2">
            <span className={`num ${best.premium! < 0 ? "pos" : "neg"}`}>
              {best.premium! < 0 ? "▼" : "▲"} {fmtPct(best.premium)}
            </span>{" "}
            vs US price · {fmtUsd(best.usdPerShare)} per share
          </p>
        </>
      ) : (
        <div className="mt-3 grid gap-2" aria-busy="true">
          <div className="skeleton h-10 w-3/4" />
          <div className="skeleton h-4 w-1/2" />
        </div>
      )}
    </div>
  );
}

/** Real fills from the server's store, else the two recorded M2 buys (IDEAS F11), clearly labelled. */
const RECORDED = [
  {
    label: "0.025705 NVDA shares · −0.22% · Ondo",
    href: "https://bscscan.com/tx/0x55ec244764dae2778357a7a446f5ec95de03cf2243fbff3ea1f3b4458a22e11a",
  },
  {
    label: "0.025675 NVDA shares · −0.10% · bStock",
    href: "https://bscscan.com/tx/0xb678802dfb1dfa6e1206ac01fdf79d18181d5d61bab23d307b7ea059abc39a8e",
  },
];

export function RecentFills() {
  const [fills, setFills] = useState<FillDto[] | null>(null);
  useEffect(() => {
    fetch("/api/fills")
      .then((r) => (r.ok ? (r.json() as Promise<FillDto[]>) : []))
      .then(setFills)
      .catch(() => setFills([]));
  }, []);
  const live = (fills ?? []).slice(0, 3);
  return (
    <div className="gcard relative z-10 ml-6 min-[981px]:ml-16" data-testid="hero-fills">
      <div className="flex items-center gap-3">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-up/20 text-up" aria-hidden>
          <Check size={14} />
        </span>
        <p className="text-sm font-semibold">Shares delivered</p>
      </div>
      <ul className="mt-3 grid gap-1.5 text-[13.5px] text-fg2">
        {live.length > 0
          ? live.map((f) => (
              <li key={f.txHash}>
                <a
                  className="num hover:text-fg"
                  href={`https://bscscan.com/tx/${f.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {fmtShares(f.shares)} {f.ticker} shares · {fmtPct(f.premium)}
                </a>
              </li>
            ))
          : RECORDED.map((f) => (
              <li key={f.href}>
                <a className="num hover:text-fg" href={f.href} target="_blank" rel="noreferrer">
                  {f.label}
                </a>
              </li>
            ))}
      </ul>
      <p className="t-meta mt-2">
        {live.length > 0
          ? "Recent buys on Tally"
          : "Recorded live buys, 2026-10-02. Click for BscScan."}
      </p>
    </div>
  );
}

/** Marquee-like strip of share prices across the buyable tickers. Fetched once; paused for reduced motion (static list). */
export function TickerStrip() {
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  useEffect(() => {
    let live = true;
    (async () => {
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
    <ul className="m-0 flex flex-wrap justify-center gap-3 p-0" aria-label="Tickers you can buy">
      {BUYABLE_TICKERS.map((t) => (
        <li key={t.ticker} className="list-none">
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

/** The live comparison preview: the same list as the trade page, read-only. */
export function ComparisonPreview() {
  const { quote, loading, error } = useContext(Ctx);
  return (
    <div>
      <IssuerList
        quote={quote}
        selected={quote?.best}
        onSelect={() => undefined}
        loading={loading}
      />
      {error && !quote ? (
        <p role="alert" className="mt-3 text-[14px] text-amber">
          {error}
        </p>
      ) : null}
      <div className="mt-5">
        <ButtonLink href="/trade/NVDA">
          Buy $6 of NVDA <ArrowRight size={16} aria-hidden />
        </ButtonLink>
      </div>
    </div>
  );
}

/** The unit trap, with the recorded NFLX numbers (IDEAS F10, 2026-10-02): flips between token price and price per share. */
export function UnitTrapCard() {
  const [perShare, setPerShare] = useState(false);
  return (
    <div className="gcard">
      <div
        role="group"
        aria-label="Show price as"
        className="inline-flex gap-1 rounded-full border border-[var(--edge)] bg-white/[0.05] p-1"
      >
        {[
          [false, "Price per token"],
          [true, "Price per share"],
        ].map(([v, l]) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={perShare === v}
            onClick={() => setPerShare(v as boolean)}
            className={`min-h-[36px] rounded-full px-4 text-[14px] font-semibold ${perShare === v ? "bg-[var(--silver)] text-[var(--silver-ink)]" : "text-fg2"}`}
          >
            {l as string}
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
          <dd className="num">{perShare ? "$68.15" : "$68.15"}</dd>
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
