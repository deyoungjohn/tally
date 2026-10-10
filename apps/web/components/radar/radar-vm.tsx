"use client";
// The Radar body built from the flow module's view models (`RadarVM` for the grade cards, `FlowPanelVM` for the ticker
// detail), reached through /api/vm/radar. Four designed states: loading, empty (with the reason), stale, degraded.

import { TokenIcon } from "@/components/ui/token-icon";
import { ArrowRight, Info } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RadarCardDisplay, RadarDisplay, RadarGradeDisplay } from "@/app/api/vm/radar/display";
import type { FlowPanelDisplay } from "@/modules/flow/view-model";
import { MorphingSearch, type MorphingSearchItem } from "@/components/motion/morphing-search";
import { Button } from "@/components/motion/button";
import { Segmented } from "@/components/motion/segmented";
import { HowWeGradeLink } from "./how-we-grade-link";
import { FlagBadge, GradeBadge, LiquidityBadge } from "@/components/trade/badges";
import { Tip } from "@/components/ui/tooltip";
import { useJson } from "@/lib/hooks/use-json";
import { ISSUER_LABEL } from "@/lib/format";
import { isTokenBuyable, nameOf } from "@/lib/tickers";
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
          {g.executable !== false && !g.ghost && isTokenBuyable(ticker, g.issuer) ? (
            <Link
              href={`/trade/${ticker}`}
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
          className="panel radar-card p-4"
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
                    <span className="text-fg2" title={w.reason}>
                      {/does not cover this window/i.test(w.reason)
                        ? "History still building"
                        : `Unavailable: ${w.reason}`}
                    </span>
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
          {i.notes
            .filter((n) => !/^Trade history incomplete:/i.test(n))
            .map((n) => (
              <p key={n} className="t-meta mt-1">
                {n}
              </p>
            ))}
          {i.notes.some((n) => /^Trade history incomplete:/i.test(n)) ? (
            <p className="t-meta mt-1" data-testid={`radarvm-history-note-${i.issuer}`}>
              Some trade history is still being collected.
            </p>
          ) : null}
          {i.whalePrints.length ? (
            <div className="mt-3 overflow-x-auto" data-testid={`radarvm-whales-${i.issuer}`}>
              <table className="w-full min-w-[320px] border-collapse text-left text-[14px]">
                <caption className="t-meta pb-2 text-left">Large trades</caption>
                <thead>
                  <tr className="text-fg3">
                    <th className="py-1.5 pr-3 font-medium">Side</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Shares</th>
                    <th className="py-1.5 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {i.whalePrints.map((p) => (
                    <tr
                      key={`${p.txHash}:${p.side}:${p.shares}`}
                      className="border-t border-white/[0.06]"
                    >
                      <td className="py-1.5 pr-3 capitalize">{p.side}</td>
                      <td className="num py-1.5 pr-3 text-right">{p.shares}</td>
                      <td className="num py-1.5 text-right">${p.usd}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/** Buys plus sells over every window of every issuer (windows with no reading count as zero). */
function activityOf(card: RadarCardDisplay): number {
  const panel = card.flowPanel;
  if (!panel || panel.state !== "ready") return 0;
  return panel.issuers.reduce(
    (sum, i) => sum + i.windows.reduce((s, w) => s + (w.reason ? 0 : w.buys + w.sells), 0),
    0,
  );
}

/** The ticker with the most trades; ties go to the first alphabetically. */
function mostActive(cards: RadarCardDisplay[]): string | null {
  let best: { ticker: string; n: number } | null = null;
  for (const c of cards) {
    const n = activityOf(c);
    if (!best || n > best.n || (n === best.n && c.ticker < best.ticker))
      best = { ticker: c.ticker, n };
  }
  return best?.ticker ?? null;
}

/** The Flow tab: search for a token, pick it, and see that one token's flow. Only one is shown at a time. */
function FlowView({ cards }: { cards: RadarCardDisplay[] }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const withFlow = useMemo(() => cards.filter((c) => c.flowPanel), [cards]);
  // The most active token is chosen once, when the tab first has data; after that only a click changes the pick, so the
  // panel never jumps while the numbers refresh.
  const busiest = useMemo(() => mostActive(withFlow), [withFlow]);
  useEffect(() => {
    if (picked === null && busiest) setPicked(busiest);
  }, [picked, busiest]);
  const suggestions = useMemo<MorphingSearchItem[]>(
    () =>
      withFlow.map((c) => ({
        id: `f-${c.ticker}`,
        title: `${nameOf(c.ticker)} · ${c.grades.map((g) => g.symbol).join(", ")}`,
        description: c.grades.map((g) => ISSUER_LABEL[g.issuer]).join(", "),
        keywords: c.grades.map((g) => g.symbol),
        value: c.ticker,
      })),
    [withFlow],
  );
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return withFlow
      .filter(
        (c) =>
          !needle ||
          `${c.ticker} ${nameOf(c.ticker)} ${c.grades.map((g) => g.symbol).join(" ")}`
            .toLowerCase()
            .includes(needle),
      )
      .slice(0, 12);
  }, [withFlow, q]);
  const card = withFlow.find((c) => c.ticker === picked) ?? null;

  if (withFlow.length === 0)
    return (
      <p className="mt-6 text-fg2" data-testid="radarvm-flow-none">
        No flow data yet. It shows up here once Tally has collected trades for these tokens.
      </p>
    );
  return (
    <div className="mt-4" data-testid="radarvm-flow-view">
      <MorphingSearch
        items={suggestions}
        value={q}
        onValueChange={setQ}
        placeholder="Search a token to see its flow"
        className="w-full min-[561px]:w-[340px]"
      />
      <ul
        className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0"
        aria-label="Tokens with flow data"
      >
        {matches.map((c) => (
          <li key={c.ticker}>
            <button
              type="button"
              aria-pressed={picked === c.ticker}
              onClick={() => setPicked(c.ticker)}
              data-testid={`radarvm-flow-pick-${c.ticker}`}
              className={`btn btn-glassy !h-9 !px-4 text-[14px] ${picked === c.ticker ? "!bg-[var(--hl)]" : ""}`}
            >
              {nameOf(c.ticker)}
            </button>
          </li>
        ))}
        {matches.length === 0 ? <li className="text-fg2">Nothing matches that search.</li> : null}
      </ul>
      {card?.flowPanel ? (
        <section className="mt-5" aria-label={`${nameOf(card.ticker)} flow`}>
          <h2 className="t-h3 !text-[19px]">
            {nameOf(card.ticker)} ·{" "}
            <span className="mono">{card.grades.map((g) => g.symbol).join(" · ")}</span>
          </h2>
          <div className="mt-3">
            <FlowPanel panel={card.flowPanel} />
          </div>
        </section>
      ) : (
        <p className="mt-5 text-fg2" data-testid="radarvm-flow-prompt">
          Pick a token to see its flow.
        </p>
      )}
    </div>
  );
}

function TickerCard({ card, grades }: { card: RadarCardDisplay; grades: RadarGradeDisplay[] }) {
  return (
    <div
      role="listitem"
      className="panel radar-card block w-full p-4"
      data-testid={`radarvm-card-${card.ticker}`}
    >
      <div className="mb-3 flex items-center gap-3">
        <TokenIcon ticker={card.ticker} size={32} />
        <p className="flex-1 font-semibold">{nameOf(card.ticker)}</p>
      </div>
      <ul className="m-0 grid list-none gap-3 p-0">
        {grades.map((g) => (
          <GradeRow key={g.address} g={g} ticker={card.ticker} />
        ))}
      </ul>
    </div>
  );
}

const STAT_TIP: Record<string, string> = {
  "Tokens checked": "Every tokenized stock Tally reads, across all issuers.",
  Liquid: "Grade A or B: good trading liquidity and no data problems found",
  "Low Liquidity": "Grade C to F: trading is thin or the data is inconsistent.",
  "Not Tradable": "Under $1,000 of cleaned 24-hour volume, so the price can be stale.",
  "Unit traps":
    "Tokens that are more than one share, so price and balance look off by that factor.",
};

export function Stats({ grades }: { grades: RadarGradeDisplay[] }) {
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
        <div key={k} className="panel radar-card p-4">
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

const PAGE = 24;

/** How many columns fit: one on a phone, two from 761px, three from 1100px (matches the old CSS columns). */
function useColumnCount() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const two = window.matchMedia("(min-width: 761px)");
    const three = window.matchMedia("(min-width: 1100px)");
    const update = () => setN(three.matches ? 3 : two.matches ? 2 : 1);
    update();
    two.addEventListener("change", update);
    three.addEventListener("change", update);
    return () => {
      two.removeEventListener("change", update);
      three.removeEventListener("change", update);
    };
  }, []);
  return n;
}

/**
 * The cards, loaded on demand: the first page at once, the next page whenever the end comes near (and by a button, for
 * keyboards). Cards are dealt into columns one by one, so adding more never moves the ones already on screen, and each
 * card keeps its own height.
 */
function RadarMasonry({
  cards,
}: {
  cards: { card: RadarCardDisplay; grades: RadarGradeDisplay[] }[];
}) {
  const [limit, setLimit] = useState(PAGE);
  const cols = useColumnCount();
  const end = useRef<HTMLDivElement>(null);
  const more = limit < cards.length;
  useEffect(() => {
    const el = end.current;
    if (!more || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting))
          setLimit((l) => Math.min(l + PAGE, cards.length));
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [more, limit, cards.length]);
  const shown = cards.slice(0, limit);
  const columns = Array.from({ length: cols }, (_, c) => shown.filter((_, i) => i % cols === c));
  return (
    <>
      <div
        role="list"
        className="mt-3 flex items-start gap-3"
        data-testid="radar-masonry"
        data-shown={shown.length}
      >
        {columns.map((col, c) => (
          <div key={c} role="presentation" className="flex min-w-0 flex-1 flex-col gap-3">
            {col.map(({ card, grades }) => (
              <TickerCard key={card.ticker} card={card} grades={grades} />
            ))}
          </div>
        ))}
      </div>
      {more ? (
        <div ref={end} className="mt-4 flex flex-col items-center gap-2" data-testid="radar-more">
          <p className="t-meta" aria-live="polite">
            Showing {shown.length} of {cards.length} stocks
          </p>
          <Button
            variant="glassy"
            onClick={() => setLimit((l) => Math.min(l + PAGE, cards.length))}
          >
            Show more
          </Button>
        </div>
      ) : cards.length > PAGE ? (
        <p className="t-meta mt-4 text-center">All {cards.length} stocks shown.</p>
      ) : null}
    </>
  );
}

export function RadarVmBody() {
  const { data: env, error } = useJson<VmEnvelope<RadarDisplay>>("/api/vm/radar", {
    refreshMs: 60_000,
  });
  const [view, setView] = useState<"tokens" | "flow">("tokens");
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
            Radar is catching up. Showing the last good grades.
          </p>
        ) : null}
      </div>

      <div className="mt-6 flex justify-center">
        <Segmented
          size="lg"
          label="Radar sections"
          value={view}
          onChange={setView}
          options={[
            { value: "tokens", label: "Tokens" },
            { value: "flow", label: "Flow" },
          ]}
        />
      </div>

      {view === "flow" ? (
        <FlowView cards={vm.cards} />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
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

          <RadarMasonry key={`${filter}|${q}`} cards={cards} />
          {cards.length === 0 ? (
            <p className="mt-6 text-fg2">Nothing matches that filter.</p>
          ) : null}
        </>
      )}
    </>
  );
}

/** The Home page's Radar preview, from the same view model as the Radar page: every token graded, the worst few listed. */
export function HomeRadarVm() {
  const { data: env, error } = useJson<VmEnvelope<RadarDisplay>>("/api/vm/radar", {
    refreshMs: 60_000,
  });
  const vm = env?.vm ?? null;
  const all = useMemo(() => vm?.cards.flatMap((c) => c.grades) ?? [], [vm]);
  const worst = useMemo(
    () =>
      all
        .filter(flagged)
        .sort((a, b) => rank(b) - rank(a) || "ABCDF".indexOf(b.grade) - "ABCDF".indexOf(a.grade))
        .slice(0, 4),
    [all],
  );
  return (
    <div data-testid="home-radar">
      {vm && vm.state === "ready" ? (
        <Stats grades={all} />
      ) : error && !env ? (
        <p className="text-amber">{error}</p>
      ) : env && (env.degraded || vm?.state !== "ready") ? (
        <p className="text-fg2">Radar is catching up. Open Radar for the latest.</p>
      ) : (
        <div className="skeleton h-[96px]" aria-busy="true" />
      )}
      {vm && vm.state === "ready" ? (
        <>
          <p className="t-meta mb-2 mt-5">Flagged right now</p>
          <ul className="m-0 grid list-none gap-3 p-0">
            {worst.map((g) => (
              <li key={g.address} className="panel radar-card p-4">
                <ul className="m-0 list-none p-0">
                  <GradeRow g={g} ticker={g.symbol} />
                </ul>
              </li>
            ))}
          </ul>
          {worst.length === 0 ? (
            <p className="text-fg2">Nothing flagged in the tokens checked.</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
