"use client";

import { TokenIcon } from "@/components/ui/token-icon";
import { AlertTriangle, ArrowRight, Building2, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { RadarReport, RadarRow } from "@tally/engine";
import { MorphingSearch, type MorphingSearchItem } from "@/components/motion/morphing-search";
import { Segmented } from "@/components/motion/segmented";
import { nameOf, tokenPair } from "@/lib/tickers";
import { FlagBadge, GradeBadge, LiquidityBadge } from "@/components/trade/badges";
import { useJson } from "@/lib/hooks/use-json";
import { ISSUER_LABEL, fmtUsd } from "@/lib/format";
import { isTokenBuyable, issuersOf } from "@/lib/tickers";
import { Tip } from "@/components/ui/tooltip";
import { LearnMore } from "@/components/learn-more";
import { useModuleFlagsState } from "@/lib/hooks/use-flags";
import { RadarVmBody, type RadarView } from "./radar-vm";
import { TabSubtitle } from "@/components/tab-subtitle";
import { HowWeGradeLink } from "./how-we-grade-link";

export const useRadar = () => useJson<RadarReport>("/api/radar");

const flagged = (r: RadarRow) => r.grade !== "A" && r.grade !== "B";
/** 0 Liquid, 1 Low Liquidity, 2 Not Tradable. */
export const liquidityRank = (r: RadarRow) => (r.flags.includes("ghost") ? 2 : flagged(r) ? 1 : 0);

const STAT_TIP: Record<string, string> = {
  "Tokens checked": "Every tokenized stock Tally reads, across all issuers.",
  Liquid: "Grade A or B: good trading liquidity and no data problems found",
  "Low Liquidity": "Grade C to F: trading is thin or the data is inconsistent.",
  "Not Tradable":
    "Under $1,000 traded in 24 hours, so the price can be stale. Tally does not let you buy these.",
  "Unit traps":
    "Tokens that are more than one share, so price and balance look off by that factor.",
};

export function RadarStats({ rows }: { rows: RadarRow[] }) {
  const stats = [
    ["Tokens checked", rows.length],
    ["Liquid", rows.filter((r) => !flagged(r)).length],
    ["Low Liquidity", rows.filter(flagged).length],
    ["Not Tradable", rows.filter((r) => r.flags.includes("ghost")).length],
    ["Unit traps", rows.filter((r) => r.unitTrap).length],
  ] as const;
  return (
    <dl className="m-0 grid grid-cols-2 gap-3 min-[761px]:grid-cols-5">
      {stats.map(([k, v]) => (
        <div key={k} className="panel radar-card p-4">
          <dt className="t-meta">
            <Tip text={STAT_TIP[k]} className="items-center">
              {k}
            </Tip>
          </dt>
          <dd className="t-big m-0 mt-1 !text-[clamp(29px,4vw,41px)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RadarRowCard({ r }: { r: RadarRow }) {
  return (
    <li
      className="panel radar-card mb-3 block break-inside-avoid list-none p-4"
      data-testid={`radar-${r.symbol}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <TokenIcon symbol={r.symbol} size={32} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {ISSUER_LABEL[r.issuer]} <span className="mono text-[13px] text-fg3">{r.symbol}</span>
            <LiquidityBadge grade={r.grade} />
            {r.flags.includes("ghost") ? <FlagBadge flag="ghost" /> : null}
            {r.unitTrap ? <FlagBadge flag="unit-trap" /> : null}
          </p>
          <p className="mt-1 text-[14px] text-fg2">
            {r.multiplier === undefined
              ? "Share count unavailable"
              : `${Number(r.multiplier.toFixed(6))} shares per token`}
            {r.volume24hUsd === undefined
              ? ""
              : ` · ${fmtUsd(r.volume24hUsd, 0)} traded in 24h on BNB Chain`}
          </p>
          {r.reasons.length ? (
            <ul className="m-0 mt-2 list-disc pl-5 text-[14.5px] text-fg2">
              {r.reasons.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[14.5px] text-fg3">No integrity issues found.</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <GradeBadge grade={r.grade} />
          {r.executable && isTokenBuyable(r.ticker, r.issuer) ? (
            <Link
              href={`/trade/${r.ticker}`}
              className="inline-flex min-h-[44px] items-center gap-1 text-[14px] link-text"
            >
              Buy <ArrowRight size={13} aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Suggestions: every ticker Tally covers (with who issues it), then the issuers. Tickers Tally can buy come first. */
function radarSuggestions(rows: RadarRow[]): MorphingSearchItem[] {
  const byTicker = new Map<string, RadarRow[]>();
  for (const r of rows) byTicker.set(r.ticker, [...(byTicker.get(r.ticker) ?? []), r]);
  const tickers = [...byTicker.entries()]
    .sort(
      ([a], [b]) =>
        Number(issuersOf(b).length > 0) - Number(issuersOf(a).length > 0) || a.localeCompare(b),
    )
    .map(([ticker, list]): MorphingSearchItem => {
      const issuers = [...new Set(list.map((r) => ISSUER_LABEL[r.issuer]))].join(", ");
      return {
        id: `t-${ticker}`,
        title: `${nameOf(ticker)} · ${list.map((r) => r.symbol).join(", ")}`,
        description: issuers,
        keywords: list.map((r) => r.symbol),
        icon: Search,
        value: ticker,
      };
    });
  const issuers = (["ondo", "bstock", "xstocks"] as const)
    .filter((i) => rows.some((r) => r.issuer === i))
    .map((i): MorphingSearchItem => ({
      id: `i-${i}`,
      title: ISSUER_LABEL[i]!,
      description: "All tokens from this issuer",
      icon: Building2,
      value: i,
    }));
  return [...tickers, ...issuers];
}

type Filter = "all" | "flagged" | "ghost" | "unit";

/** Today's Radar body (engine report). Shown while the `flow` flag is off. */
function RadarLegacyBody() {
  const { data, error, loading } = useRadar();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const suggestions = useMemo(() => radarSuggestions(data?.rows ?? []), [data]);
  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const f =
      filter === "flagged"
        ? all.filter(flagged)
        : filter === "ghost"
          ? all.filter((r) => r.flags.includes("ghost"))
          : filter === "unit"
            ? all.filter((r) => r.unitTrap)
            : all;
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? f.filter((r) => `${r.ticker} ${r.symbol} ${r.issuer}`.toLowerCase().includes(needle))
      : f;
    // Liquid first, then Low Liquidity, then Not Tradable, whatever the active filter; best grade first inside each group.
    return [...filtered].sort(
      (a, b) =>
        liquidityRank(a) - liquidityRank(b) ||
        "ABCDF".indexOf(a.grade) - "ABCDF".indexOf(b.grade) ||
        a.ticker.localeCompare(b.ticker),
    );
  }, [data, filter, q]);

  return (
    <>
      <div className="mt-8">
        {data ? (
          <RadarStats rows={data.rows} />
        ) : (
          <div className="skeleton h-[96px]" aria-busy="true" />
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Filter tokens"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "flagged", label: "Low Liquidity" },
            { value: "ghost", label: "Not Tradable" },
            { value: "unit", label: "Unit trap" },
          ]}
        />
        <MorphingSearch
          items={suggestions}
          value={q}
          onValueChange={setQ}
          placeholder="Search a stock or issuer"
          className="w-full min-[561px]:w-[300px]"
        />
      </div>
      <HowWeGradeLink />

      {error && !data ? (
        <p role="alert" className="mt-6 text-amber">
          {error}
        </p>
      ) : null}
      <ul
        className="m-0 mt-4 columns-1 gap-3 p-0 min-[761px]:columns-2 min-[1100px]:columns-3"
        aria-busy={loading}
      >
        {!data
          ? [0, 1, 2, 3].map((i) => (
              <li key={i} className="skeleton mb-3 h-[120px] list-none break-inside-avoid" />
            ))
          : rows.map((r) => <RadarRowCard key={r.address} r={r} />)}
      </ul>
      {data && rows.length === 0 ? (
        <p className="mt-6 text-fg2">Nothing matches that filter.</p>
      ) : null}
      {data?.failed.length ? (
        <p className="t-meta mt-4 flex items-start gap-2 text-amber" role="status">
          <AlertTriangle size={14} className="mt-0.5 flex-none" aria-hidden /> Couldn&apos;t read:{" "}
          {data.failed.map((f) => tokenPair(f.ticker)).join(", ")}. They are not shown rather than
          shown as safe.
        </p>
      ) : null}
    </>
  );
}

/** The full Radar page. With the `flow` flag on the grades and flow panels come from the flow module's view models. */
export function RadarPage() {
  const { flags, ready } = useModuleFlagsState();
  const [view, setView] = useState<RadarView>("tokens");
  return (
    <main id="main" className="wrap pb-24 pt-10 min-[561px]:pt-14">
      <p className="t-kicker">Radar</p>
      <h1 className="t-h2 mt-3 max-w-[22ch]">Spot liquid and non-tradable tokens in a glance.</h1>
      <TabSubtitle
        className="mt-3"
        active={flags.flow ? view : "tokens"}
        items={{
          tokens: (
            <>
              Radar grades every token A to F and tells you why, in plain words.{" "}
              <LearnMore concept="liquidity" />
            </>
          ),
          flow: "Flow shows you how liquidity is flowing in and out of a token in real time.",
        }}
      />

      {!ready ? (
        <div className="mt-8 skeleton h-[96px]" aria-busy="true" />
      ) : flags.flow ? (
        <RadarVmBody view={view} onViewChange={setView} />
      ) : (
        <RadarLegacyBody />
      )}
    </main>
  );
}
