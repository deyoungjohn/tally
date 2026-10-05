"use client";

import { ChevronDown } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import type { QuoteDto, RowDto } from "@/lib/dto";
import { ISSUER_LABEL, fmtUsd } from "@/lib/format";
import { SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { FlagBadge, GradeBadge, TokenLogo } from "./badges";
import { LivePct, LiveShares, LiveUsd } from "@/components/motion/live";
import { Tip } from "@/components/ui/tooltip";
import { LearnMore } from "@/components/learn-more";

function Premium({ p }: { p: number | undefined }) {
  if (p === undefined) return <span className="text-fg3">–</span>;
  // Colour is never the only signal: an arrow and the sign say it too.
  const cheaper = p < 0;
  return (
    <span className={cn("num", cheaper ? "pos" : p > 0 ? "neg" : "text-fg2")}>
      {cheaper ? "▼ " : p > 0 ? "▲ " : ""}
      <LivePct value={p} /> <span className="text-fg3">vs US</span>
    </span>
  );
}

/** Premium bar centred on 0 (the US price), transform-only so it glides (DESIGN §2.9). */
function PremiumBar({ p }: { p: number | undefined }) {
  const reduce = useReducedMotion();
  const w = p === undefined ? 0 : Math.min(Math.abs(p) / 0.01, 1); // full half-bar at ±1%
  return (
    <div className="relative mt-2 h-1.5 rounded-full bg-white/[0.06]" aria-hidden>
      <span className="absolute left-1/2 top-[-2px] h-[10px] w-px bg-white/30" />
      {p !== undefined ? (
        <motion.span
          className={cn(
            "absolute top-0 h-full w-1/2 rounded-full",
            p < 0 ? "bg-up/70" : "bg-red/70",
          )}
          style={{
            left: p < 0 ? 0 : "50%",
            transformOrigin: p < 0 ? "right center" : "left center",
          }}
          initial={false}
          animate={{ scaleX: w }}
          transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
        />
      ) : null}
    </div>
  );
}

function Row({ r, selected, onSelect }: { r: RowDto; selected: boolean; onSelect: () => void }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const pickable = r.executable && r.shares !== undefined;
  return (
    <motion.li
      layout={reduce ? false : "position"}
      transition={SPRING_LAYOUT}
      className={cn(
        "panel min-w-0 list-none p-0",
        r.isBest && "row-best",
        selected && pickable && "!bg-white/[0.07]",
      )}
      data-testid={`row-${r.symbol}`}
    >
      <button
        type="button"
        aria-pressed={selected}
        disabled={!pickable}
        onClick={onSelect}
        className="flex w-full flex-col gap-1 rounded-[18px] p-4 text-left disabled:cursor-default"
      >
        <span className="flex items-center gap-3">
          <TokenLogo ticker={r.symbol} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{ISSUER_LABEL[r.issuer]}</span>
              <span className="mono text-[13px] text-fg3">{r.symbol}</span>
              {r.isBest ? (
                <Tip
                  text="Best: the most shares for your money right now, network fee included."
                  focusable={false}
                >
                  <span className="chip-best">Best</span>
                </Tip>
              ) : null}
              {r.flags.includes("ghost") ? <FlagBadge flag="ghost" inButton /> : null}
              {r.unitTrap ? (
                <Tip
                  text="Unit trap: one token is more than one share, so its price and balance look off by that factor. Tally always shows shares."
                  focusable={false}
                >
                  <span className="badge badge-amber">{r.multiplier} shares per token</span>
                </Tip>
              ) : null}
            </span>
            {pickable ? (
              <span className="mt-1 block text-[14px] text-fg2">
                <LiveUsd value={r.usdPerShare} className="num text-fg" /> per share ·{" "}
                <Premium p={r.premium} />
              </span>
            ) : (
              <span className="mt-1 block text-[14px] text-fg3">
                {r.notExecutableReason ?? r.error ?? "Not available"}
              </span>
            )}
          </span>
          <span className="text-right">
            {pickable ? (
              <LiveShares
                value={r.shares}
                className="num flex justify-end text-[18px] font-semibold"
              />
            ) : null}
            {pickable ? <span className="t-meta">shares</span> : null}
          </span>
          <GradeBadge grade={r.grade} inButton />
        </span>
        {pickable ? <PremiumBar p={r.premium} /> : null}
      </button>
      <div className="flex items-center justify-between gap-3 px-4 pb-3 text-[13.5px] text-fg3">
        <span className="num">
          {r.feeUsd === undefined ? "" : `Network fee ≈ ${fmtUsd(r.feeUsd, 3)}`}
          {r.hops ? ` · ${r.hops} ${r.hops === 1 ? "step" : "steps"}` : ""}
        </span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-[44px] items-center gap-1 rounded-full px-2 text-fg2 hover:text-fg"
        >
          Why?{" "}
          <ChevronDown
            size={14}
            aria-hidden
            className={cn("transition-transform", open && "rotate-180")}
          />
        </button>
      </div>
      {open ? (
        <div
          className="border-t border-white/[0.06] px-4 py-3 text-[14.5px] text-fg2"
          data-testid={`why-${r.symbol}`}
        >
          {r.routeText ? (
            <p>
              Route: <span className="text-fg">{r.routeText}</span>
            </p>
          ) : null}
          {r.gradeReasons.length ? (
            <ul className="mt-2 list-disc pl-5">
              {r.gradeReasons.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1">No integrity issues found.</p>
          )}
        </div>
      ) : null}
    </motion.li>
  );
}

export function IssuerList({
  quote,
  selected,
  onSelect,
  loading,
  showTitle = true,
}: {
  quote: QuoteDto | null;
  selected: string | undefined;
  onSelect: (symbol: string) => void;
  loading: boolean;
  showTitle?: boolean;
}) {
  if (!quote)
    return (
      <div className="mt-4 grid gap-3" aria-busy="true" aria-label="Loading quotes">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-[104px]" />
        ))}
      </div>
    );
  // Executable rows first (ranked), then the rest (shown with their integrity grade, never routed to).
  const rows = [...quote.rows].sort(
    (a, b) => Number(b.executable) - Number(a.executable) || (a.rank ?? 99) - (b.rank ?? 99),
  );
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        {showTitle ? <h2 className="t-h3 !text-[19px]">Compared by issuer</h2> : <span />}
        <span className="t-meta" aria-live="off">
          {loading ? "Refreshing…" : "Live"}
        </span>
      </div>
      <div className="mb-3">
        <p className="t-meta">
          Ranked by shares you get, not by token price.{" "}
          <LearnMore concept="premium" label="Read more" />
        </p>
      </div>
      <LayoutGroup>
        <ul className="m-0 grid grid-cols-1 gap-3 p-0" aria-label="Quotes by issuer">
          {rows.map((r) => (
            <Row
              key={r.symbol}
              r={r}
              selected={selected === r.symbol}
              onSelect={() => onSelect(r.symbol)}
            />
          ))}
        </ul>
      </LayoutGroup>
      {quote.saving ? (
        <p className="t-meta mt-3">
          {quote.best} saves {fmtUsd(quote.saving.usd, 3)} ({(quote.saving.pct * 100).toFixed(2)}%)
          vs {quote.saving.vsSymbol}, network fee included.
        </p>
      ) : null}
      {quote.warnings.map((w) => (
        <p key={w} className="t-meta mt-2 text-amber" role="status">
          {w}
        </p>
      ))}
    </div>
  );
}
