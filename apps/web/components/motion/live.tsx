"use client";
// Readings that change while the page is open (prices, shares, balances) roll digit by digit.
// A missing value renders an en dash, like the rest of the site.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE_OUT } from "@/lib/ease";
import { fmtPct, fmtShares, fmtUsd } from "@/lib/format";
import { TREND_CLASS, usePriceTrend } from "@/lib/hooks/use-price-trend";
import { cn } from "@/lib/utils";
import { NumberTicker } from "./animated-number";

type V = number | null | undefined;
const ok = (v: V): v is number => v !== null && v !== undefined && Number.isFinite(v);

export function LiveUsd({ value, d = 2, className }: { value: V; d?: number; className?: string }) {
  if (!ok(value)) return <span className={className}>–</span>;
  return (
    <NumberTicker
      value={value}
      format={(n) => fmtUsd(n, d)}
      startOnView={false}
      duration={0.6}
      className={className}
    />
  );
}

export function LiveShares({ value, className }: { value: V; className?: string }) {
  if (!ok(value)) return <span className={className}>–</span>;
  return (
    <NumberTicker
      value={value}
      format={fmtShares}
      startOnView={false}
      duration={0.6}
      className={className}
    />
  );
}

export function LivePct({ value, d = 2, className }: { value: V; d?: number; className?: string }) {
  if (!ok(value)) return <span className={className}>–</span>;
  return (
    <NumberTicker
      value={value}
      format={(n) => fmtPct(n, d)}
      startOnView={false}
      duration={0.6}
      className={className}
    />
  );
}

export function LiveNumber({
  value,
  decimals,
  className,
}: {
  value: V;
  decimals: number;
  className?: string;
}) {
  if (!ok(value)) return <span className={className}>–</span>;
  return (
    <NumberTicker
      value={value}
      decimals={decimals}
      startOnView={false}
      duration={0.6}
      className={className}
    />
  );
}

/** A word that changes while the page is open (the top issuer's symbol): the old text rolls up and out, the new one rolls in, like a digit. */
export function LiveText({ text, className }: { text: string; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span
      className={`relative inline-flex overflow-hidden align-bottom ${className ?? ""}`}
      style={{ height: "1.3em" }}
    >
      <span className="sr-only">{text}</span>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={text}
          aria-hidden="true"
          className="inline-block leading-[1.3]"
          initial={reduce ? false : { y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: "-100%", opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.45, ease: EASE_OUT }}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** A price that turns green when it ticks up, red when it ticks down and white when it holds still. */
export function TrendUsd({
  value,
  tick,
  d = 2,
  className,
}: {
  value: V;
  /** Changes identity with every fresh reading (the fetched row), so an unchanged price turns white. */
  tick?: unknown;
  d?: number;
  className?: string;
}) {
  const trend = usePriceTrend(value, tick);
  return (
    <LiveUsd
      value={value}
      d={d}
      className={cn("transition-colors duration-300", TREND_CLASS[trend], className)}
    />
  );
}
