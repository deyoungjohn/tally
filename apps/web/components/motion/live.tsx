"use client";
// Readings that change while the page is open (prices, shares, balances) roll digit by digit.
// A missing value renders an en dash, like the rest of the site.

import { fmtPct, fmtShares, fmtUsd } from "@/lib/format";
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
