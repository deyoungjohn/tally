"use client";

import { AlertTriangle, ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { RadarReport, RadarRow } from "@tally/engine";
import { ButtonLink } from "@/components/motion/button";
import { Segmented } from "@/components/motion/segmented";
import { FlagBadge, GradeBadge, TokenLogo } from "@/components/trade/badges";
import { useJson } from "@/lib/hooks/use-json";
import { ISSUER_LABEL, fmtUsd } from "@/lib/format";
import { isBuyable } from "@/lib/tickers";

export const useRadar = () => useJson<RadarReport>("/api/radar");

const flagged = (r: RadarRow) => r.grade !== "A" && r.grade !== "B";

export function RadarStats({ rows }: { rows: RadarRow[] }) {
  const stats = [
    ["Tokens checked", rows.length],
    ["Clean (A or B)", rows.filter((r) => !flagged(r)).length],
    ["Flagged (C to F)", rows.filter(flagged).length],
    ["Ghost markets", rows.filter((r) => r.flags.includes("ghost")).length],
    ["Unit traps", rows.filter((r) => r.unitTrap).length],
  ] as const;
  return (
    <dl className="m-0 grid grid-cols-2 gap-3 min-[761px]:grid-cols-5">
      {stats.map(([k, v]) => (
        <div key={k} className="panel p-4">
          <dt className="t-meta">{k}</dt>
          <dd className="t-big m-0 mt-1 !text-[clamp(28px,4vw,40px)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RadarRowCard({ r }: { r: RadarRow }) {
  return (
    <li className="panel list-none p-4" data-testid={`radar-${r.symbol}`}>
      <div className="flex flex-wrap items-start gap-3">
        <TokenLogo ticker={r.symbol} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {ISSUER_LABEL[r.issuer]} <span className="mono text-[12px] text-fg3">{r.symbol}</span>
            {r.flags.includes("ghost") ? <FlagBadge flag="ghost" /> : null}
            {r.unitTrap ? <FlagBadge flag="unit-trap" /> : null}
          </p>
          <p className="mt-1 text-[13px] text-fg2">
            {r.multiplier === undefined
              ? "Share count unavailable"
              : `${Number(r.multiplier.toFixed(6))} shares per token`}
            {r.volume24hUsd === undefined
              ? ""
              : ` · ${fmtUsd(r.volume24hUsd, 0)} traded in 24h on BNB Chain`}
          </p>
          {r.reasons.length ? (
            <ul className="m-0 mt-2 list-disc pl-5 text-[13.5px] text-fg2">
              {r.reasons.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13.5px] text-fg3">No integrity issues found.</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <GradeBadge grade={r.grade} />
          {r.executable && isBuyable(r.ticker) ? (
            <Link
              href={`/trade/${r.ticker}`}
              className="inline-flex min-h-[44px] items-center gap-1 text-[13px] text-blue"
            >
              Buy <ArrowRight size={13} aria-hidden />
            </Link>
          ) : (
            <span className="t-meta">{r.executable ? "Compare only" : "Not buyable"}</span>
          )}
        </div>
      </div>
    </li>
  );
}

type Filter = "all" | "flagged" | "ghost" | "unit";

/** The full Radar page body. */
export function RadarPage() {
  const { data, error, loading } = useRadar();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
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
    return [...filtered].sort(
      (a, b) =>
        "FDCBA".indexOf(a.grade) - "FDCBA".indexOf(b.grade) || a.ticker.localeCompare(b.ticker),
    );
  }, [data, filter, q]);

  return (
    <main id="main" className="wrap pb-24 pt-10 min-[561px]:pt-14">
      <p className="t-kicker">Radar</p>
      <h1 className="t-h2 mt-3 max-w-[22ch]">Spot the tokens that would mislead you.</h1>
      <p className="t-lead mt-3 max-w-[62ch]">
        The same ticker can be a different amount of stock, a market nobody trades, or data that
        disagrees with itself. Radar grades every token A to F and says why, in plain words.
      </p>

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
            { value: "flagged", label: "Flagged" },
            { value: "ghost", label: "Ghost" },
            { value: "unit", label: "Unit trap" },
          ]}
        />
        <label className="relative block w-full min-[561px]:w-[280px]">
          <span className="sr-only">Search tokens</span>
          <Search
            size={16}
            aria-hidden
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg3"
          />
          <input
            className="input !pl-10"
            placeholder="Search a stock or issuer"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>

      {error && !data ? (
        <p role="alert" className="mt-6 text-amber">
          {error}
        </p>
      ) : null}
      <ul
        className="m-0 mt-4 grid grid-cols-1 gap-3 p-0 min-[981px]:grid-cols-2"
        aria-busy={loading}
      >
        {!data
          ? [0, 1, 2, 3].map((i) => <li key={i} className="skeleton h-[120px] list-none" />)
          : rows.map((r) => <RadarRowCard key={r.address} r={r} />)}
      </ul>
      {data && rows.length === 0 ? (
        <p className="mt-6 text-fg2">Nothing matches that filter.</p>
      ) : null}
      {data?.failed.length ? (
        <p className="t-meta mt-4 flex items-start gap-2 text-amber" role="status">
          <AlertTriangle size={14} className="mt-0.5 flex-none" aria-hidden /> Couldn&apos;t read:{" "}
          {data.failed.map((f) => f.ticker).join(", ")}. They are not shown rather than shown as
          safe.
        </p>
      ) : null}

      <section className="glass mt-12 p-6 min-[561px]:p-8" aria-labelledby="how-grades">
        <h2 id="how-grades" className="t-h3">
          How a grade is made
        </h2>
        <p className="mt-2 max-w-[70ch] text-fg2">
          Every token starts at 100 points. Each problem below takes points off, and every deduction
          is shown with its reason.
        </p>
        <ul className="m-0 mt-4 grid grid-cols-1 gap-3 p-0 min-[761px]:grid-cols-2">
          {[
            [
              "Share counts disagree (−25)",
              "Sources disagree by more than 0.1% on how many shares one token is.",
            ],
            [
              "Price far from the US price (−30)",
              "More than 2% away from the US price while the market is open.",
            ],
            [
              "Almost no trading (−40)",
              "Under $1,000 traded in 24 hours on BNB Chain: a ghost market with stale prices.",
            ],
            [
              "Paused or limited (−50 / −10)",
              "The issuer paused the token, or limited it around earnings.",
            ],
            [
              "Status unknown (−10)",
              "We couldn't read whether it trades, and we never assume it does.",
            ],
            [
              "Old reserve report (−10)",
              "The issuer's latest reserve attestation is more than 3 days old.",
            ],
          ].map(([h, b]) => (
            <li key={h} className="panel list-none p-4">
              <p className="font-semibold">{h}</p>
              <p className="mt-1 text-[14px] text-fg2">{b}</p>
            </li>
          ))}
        </ul>
        <p className="t-meta mt-4">
          A is 90 or more, B 75, C 60, D 40, F below that. A unit trap (one token being more than
          one share) adds a badge, not a deduction.
        </p>
        <div className="mt-6">
          <ButtonLink href="/trade">
            Compare a stock <ArrowRight size={16} aria-hidden />
          </ButtonLink>
        </div>
      </section>
    </main>
  );
}
