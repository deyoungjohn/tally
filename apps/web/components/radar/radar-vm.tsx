"use client";
// The Radar body built from the flow module's view models (`RadarVM` for the grade cards, `FlowPanelVM` for the ticker
// detail), reached through /api/vm/radar. Four designed states: loading, empty (with the reason), stale, degraded.

import { ArrowRight, ChevronDown, Info } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { RadarCardDisplay, RadarDisplay, RadarGradeDisplay } from "@/app/api/vm/radar/display";
import type { FlowPanelDisplay } from "@/modules/flow/view-model";
import { MorphingSearch, type MorphingSearchItem } from "@/components/motion/morphing-search";
import { Segmented } from "@/components/motion/segmented";
import { FlagBadge, GradeBadge, LiquidityBadge, TokenLogo } from "@/components/trade/badges";
import { Tip } from "@/components/ui/tooltip";
import { useJson } from "@/lib/hooks/use-json";
import { ISSUER_LABEL } from "@/lib/format";
import { isBuyable, nameOf } from "@/lib/tickers";
import {
  VmDegraded,
  VmEmpty,
  VmFreshness,
  VmSkeleton,
  ageText,
  type VmEnvelope,
} from "@/components/portfolio/vm-shared";

type Filter = "all" | "flagged" | "ghost" | "unit";

const flagged = (g: RadarGradeDisplay) => g.grade !== "A" && g.grade !== "B";
const rank = (g: RadarGradeDisplay) => (g.ghost ? 2 : flagged(g) ? 1 : 0);

/** The one place the two volume figures are explained, so the numbers are never read as the same thing. */
export const BASIS_TIP =
  "Radar grades use cleaned flow: trades left after bot wallets and router hops are removed. The grade on the Trade page quote uses raw 24-hour on-chain volume. Cleaned flow is never larger than raw volume, so the two grades can differ on purpose.";

const BASIS_LABEL: Record<RadarGradeDisplay["gradeBasis"], string> = {
  "cleaned flow": "Graded on cleaned flow",
  engine: "Graded on raw volume",
};

function BasisTag({ g }: { g: RadarGradeDisplay }) {
  return (
    <Tip text={BASIS_TIP}>
      <span
        className="t-meta inline-flex items-center gap-1 underline decoration-dotted underline-offset-4"
        data-testid={`radarvm-basis-${g.symbol}`}
      >
        {BASIS_LABEL[g.gradeBasis]} <Info size={12} aria-hidden />
      </span>
    </Tip>
  );
}

const usdWhole = (s: string) => `$${BigInt(s).toLocaleString("en-US")}`;

function GradeRow({ g, ticker }: { g: RadarGradeDisplay; ticker: string }) {
  return (
    <li
      className="list-none border-t border-line pt-3 first:border-0 first:pt-0"
      data-testid={`radarvm-${g.symbol}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {ISSUER_LABEL[g.issuer]} <span className="mono text-[13px] text-fg3">{g.symbol}</span>
            <LiquidityBadge grade={g.grade} />
            {g.ghost ? <FlagBadge flag="ghost" /> : null}
            {g.unitTrap ? <FlagBadge flag="unit-trap" /> : null}
          </p>
          <p className="mt-1 text-[14px] text-fg2">
            {g.rawVolume24hUsd === null
              ? "24h volume unknown"
              : `${usdWhole(g.rawVolume24hUsd)} raw volume in 24h on BNB Chain`}
          </p>
          {g.cleanedFlowUsd24h !== null ? (
            <p className="text-[14px] text-fg2" data-testid={`radarvm-cleaned-${g.symbol}`}>
              {usdWhole(g.cleanedFlowUsd24h)} cleaned flow in 24h
            </p>
          ) : null}
          <p className="mt-1">
            <BasisTag g={g} />
          </p>
          {g.flowReason ? <p className="t-meta mt-1">{g.flowReason}</p> : null}
          {g.reasons.length ? (
            <ul className="m-0 mt-2 list-disc pl-5 text-[14.5px] text-fg2">
              {g.reasons.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[14.5px] text-fg3">No integrity issues found.</p>
          )}
          {g.stale ? (
            <p
              className="t-meta mt-2 text-amber"
              role="status"
              data-testid={`radarvm-stale-${g.symbol}`}
            >
              Grade last updated {ageText(g.ageMs) ?? "a while ago"}; retrying.
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <GradeBadge grade={g.grade} />
          {g.executable !== false && !g.ghost && isBuyable(ticker) ? (
            <Link
              href={`/trade/${ticker}`}
              className="inline-flex min-h-[44px] items-center gap-1 text-[14px] text-blue"
            >
              Buy <ArrowRight size={13} aria-hidden />
            </Link>
          ) : (
            <span className="t-meta" title={g.executableReason ?? undefined}>
              {g.executable === false || g.ghost ? "Not buyable" : "Compare only"}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

const WINDOW_LABEL: Record<string, string> = {
  "1h": "Last hour",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
};

/** `FlowPanelVM` for one ticker: net share flow per window, last real trade, holder concentration and whale prints. */
export function FlowPanel({ panel }: { panel: FlowPanelDisplay }) {
  if (panel.state !== "ready")
    return (
      <p className="t-meta" data-testid={`radarvm-flow-note-${panel.ticker}`}>
        {panel.state === "error" ? "Flow could not load." : "Flow:"}{" "}
        {panel.reason ?? "Not available."}
      </p>
    );
  return (
    <div className="grid gap-4" data-testid={`radarvm-flow-${panel.ticker}`}>
      {panel.reason ? <p className="t-meta text-amber">{panel.reason}</p> : null}
      {panel.issuers.map((i) => (
        <section
          key={i.issuer}
          aria-label={`${ISSUER_LABEL[i.issuer] ?? i.issuer} flow`}
          className="panel p-4"
        >
          <p className="flex flex-wrap items-center justify-between gap-2 font-semibold">
            {ISSUER_LABEL[i.issuer] ?? i.issuer}
            <span className="t-meta font-normal">
              {i.sourceLabel} ·{" "}
              {i.stale ? (
                <span className="text-amber" data-testid={`radarvm-flow-stale-${i.issuer}`}>
                  Stale, updated {ageText(i.ageMs) ?? "a while ago"}
                </span>
              ) : (
                `Updated ${ageText(i.ageMs) ?? "just now"}`
              )}
            </span>
          </p>
          <dl className="m-0 mt-3 grid grid-cols-1 gap-2 min-[561px]:grid-cols-3">
            {i.windows.map((w) => (
              <div key={w.window}>
                <dt className="t-meta">{WINDOW_LABEL[w.window] ?? w.window}</dt>
                <dd className="m-0">
                  {w.reason ? (
                    <span className="text-fg2">Unavailable: {w.reason}</span>
                  ) : (
                    <>
                      <span className="num font-semibold">{w.netShares}</span> net shares
                      <span className="t-meta block">
                        {w.buys} buys · {w.sells} sells
                      </span>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[14.5px] text-fg2">
            Last real trade:{" "}
            {i.lastRealTradeAgeMs === null
              ? (i.lastRealTradeReason ?? "unknown")
              : (ageText(i.lastRealTradeAgeMs) ?? "unknown")}
          </p>
          <p className="text-[14.5px] text-fg2">
            Top ten holders, excluding custody:{" "}
            {i.concentration === null
              ? (i.concentrationReason ?? "unknown")
              : `${i.concentration}%`}
          </p>
          {i.notes.map((n) => (
            <p key={n} className="t-meta mt-1">
              {n}
            </p>
          ))}
          {i.whalePrints.length ? (
            <ul className="m-0 mt-3 grid list-none gap-1 p-0 text-[14px] text-fg2">
              {i.whalePrints.map((p) => (
                <li key={`${p.txHash}:${p.side}:${p.shares}`}>
                  Large {p.side}: {p.shares} shares (${p.usd})
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function TickerCard({ card, grades }: { card: RadarCardDisplay; grades: RadarGradeDisplay[] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="panel list-none p-4" data-testid={`radarvm-card-${card.ticker}`}>
      <div className="mb-3 flex items-center gap-3">
        <TokenLogo ticker={card.ticker} />
        <p className="flex-1 font-semibold">{nameOf(card.ticker)}</p>
      </div>
      <ul className="m-0 grid list-none gap-3 p-0">
        {grades.map((g) => (
          <GradeRow key={g.address} g={g} ticker={card.ticker} />
        ))}
      </ul>
      {card.flowPanel ? (
        <div className="mt-3 border-t border-line pt-3">
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center gap-1 text-[14px] text-orange-text"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            data-testid={`radarvm-flow-toggle-${card.ticker}`}
          >
            {open ? "Hide" : "Show"} {card.ticker} flow
            <ChevronDown size={14} aria-hidden className={open ? "rotate-180" : ""} />
          </button>
          {open ? (
            <div className="mt-2">
              <FlowPanel panel={card.flowPanel} />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

const STAT_TIP: Record<string, string> = {
  "Tokens checked": "Every tokenized stock Tally reads, across all issuers.",
  Liquid: "Grade A or B: plenty of trading and no data problems found.",
  "Low Liquidity": "Grade C to F: trading is thin or the data is inconsistent.",
  "Not Tradable": "Under $1,000 of cleaned 24-hour volume, so the price can be stale.",
  "Unit traps":
    "Tokens that are more than one share, so price and balance look off by that factor.",
};

function Stats({ grades }: { grades: RadarGradeDisplay[] }) {
  const stats = [
    ["Tokens checked", grades.length],
    ["Liquid", grades.filter((g) => !flagged(g)).length],
    ["Low Liquidity", grades.filter(flagged).length],
    ["Not Tradable", grades.filter((g) => g.ghost).length],
    ["Unit traps", grades.filter((g) => g.unitTrap).length],
  ] as const;
  return (
    <dl className="m-0 grid grid-cols-2 gap-3 min-[761px]:grid-cols-5" data-testid="radarvm-stats">
      {stats.map(([k, v]) => (
        <div key={k} className="panel p-4">
          <dt className="t-meta">
            <Tip text={STAT_TIP[k]!} className="items-center">
              {k}
            </Tip>
          </dt>
          <dd className="t-big m-0 mt-1 !text-[clamp(29px,4vw,41px)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RadarVmBody() {
  const { data: env, error } = useJson<VmEnvelope<RadarDisplay>>("/api/vm/radar", {
    refreshMs: 60_000,
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const vm = env?.vm ?? null;

  const all = useMemo(() => vm?.cards.flatMap((c) => c.grades) ?? [], [vm]);
  const suggestions = useMemo<MorphingSearchItem[]>(
    () =>
      (vm?.cards ?? []).map((c) => ({
        id: `t-${c.ticker}`,
        title: `${nameOf(c.ticker)} · ${c.grades.map((g) => g.symbol).join(", ")}`,
        description: c.grades.map((g) => ISSUER_LABEL[g.issuer]).join(", "),
        keywords: c.grades.map((g) => g.symbol),
        value: c.ticker,
      })),
    [vm],
  );
  const cards = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const keep = (g: RadarGradeDisplay, ticker: string) =>
      (filter === "all" ||
        (filter === "flagged" && flagged(g) && !g.ghost) ||
        (filter === "ghost" && g.ghost) ||
        (filter === "unit" && g.unitTrap)) &&
      (!needle || `${ticker} ${g.symbol} ${g.issuer}`.toLowerCase().includes(needle));
    return (vm?.cards ?? [])
      .map((card) => ({
        card,
        grades: card.grades
          .filter((g) => keep(g, card.ticker))
          .sort((a, b) => rank(a) - rank(b) || "ABCDF".indexOf(a.grade) - "ABCDF".indexOf(b.grade)),
      }))
      .filter((x) => x.grades.length)
      .sort(
        (a, b) =>
          rank(a.grades[0]!) - rank(b.grades[0]!) || a.card.ticker.localeCompare(b.card.ticker),
      );
  }, [vm, filter, q]);

  if (!env)
    return error ? (
      <p role="alert" className="mt-8 text-amber">
        {error}
      </p>
    ) : (
      <div className="mt-8">
        <VmSkeleton rows={3} label="Loading Radar" />
      </div>
    );
  if (!vm || (env.degraded && vm.state !== "ready"))
    return (
      <div className="mt-8">
        <VmDegraded name="Radar" reason={env.reason} ageMs={env.ageMs} />
      </div>
    );
  if (vm.state === "error")
    return (
      <div className="mt-8">
        <VmDegraded name="Radar" reason={vm.reason ?? vm.error} ageMs={env.ageMs} />
      </div>
    );
  if (vm.state === "empty")
    return (
      <div className="mt-8">
        <VmEmpty
          title="No grades yet"
          reason={vm.reason ?? "Radar has no grade observations yet."}
        />
      </div>
    );

  return (
    <>
      <div className="mt-8">
        <Stats grades={all} />
      </div>
      <div className="mt-4">
        <VmFreshness
          stale={vm.stale || env.stale}
          ageMs={vm.ageMs ?? env.ageMs}
          source={vm.source}
          fixtures={env.fixtures}
        />
        {env.degraded ? (
          <p className="t-meta mt-1 text-amber" role="status" data-testid="radarvm-degraded-note">
            Radar is catching up: {env.reason ?? "the last update failed"}. Showing the last good
            grades.
          </p>
        ) : null}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
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

      <ul className="m-0 mt-4 grid grid-cols-1 gap-3 p-0 min-[981px]:grid-cols-2">
        {cards.map(({ card, grades }) => (
          <TickerCard key={card.ticker} card={card} grades={grades} />
        ))}
      </ul>
      {cards.length === 0 ? <p className="mt-6 text-fg2">Nothing matches that filter.</p> : null}
    </>
  );
}
