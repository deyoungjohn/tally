"use client";
// Shared pieces for the screens built from module view models: the four designed states (loading, empty, stale, degraded)
// and the "this is fixture data" label. Nothing here reads a view model's internals; screens pass what they show.

import { AlertTriangle, Clock, FlaskConical } from "lucide-react";
import type { ReactNode } from "react";
import type { VmEnvelope } from "@/app/api/vm/_lib";

export type { VmEnvelope };

/** "4 min ago" from a millisecond age; "less than a minute" under 60 s; null when the age is unknown. */
export function ageText(ageMs: number | null | undefined): string | null {
  if (ageMs === null || ageMs === undefined || !Number.isFinite(ageMs)) return null;
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "less than a minute ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} days ago`;
}

export function VmSkeleton({ rows = 2, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label={label} data-testid="vm-loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-[140px]" />
      ))}
    </div>
  );
}

/** The three reasons the health logic writes itself; anything else is a worker's raw error text. */
const PLAIN_REASON = /^(No successful update yet|Worker update is overdue|Latest update failed)$/;

/** The module is down or has never updated: a designed card, no data, no guess. */
export function VmDegraded({
  name,
  reason,
  ageMs,
}: {
  name: string;
  reason: string | null;
  ageMs: number | null;
}) {
  const age = ageText(ageMs);
  return (
    <section
      role="status"
      aria-label={`${name} degraded`}
      className="glass p-5 min-[561px]:p-6"
      data-testid="vm-degraded"
    >
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle size={18} className="text-amber" aria-hidden /> {name} is catching up
      </p>
      {/* A worker's own error text ("database is locked", "start collect-flow first") is for the logs, not for visitors:
          it stays in the hover title and the page says something plain. */}
      <p className="mt-2 text-fg2" title={reason ?? undefined}>
        {reason
          ? PLAIN_REASON.test(reason)
            ? reason
            : "Waiting for fresh data."
          : "No successful update yet."}
        {age ? ` Last good update ${age}.` : ""}
      </p>
    </section>
  );
}

export function VmEmpty({
  title,
  reason,
  children,
}: {
  title: string;
  reason: string;
  children?: ReactNode;
}) {
  return (
    <section className="glass p-6 min-[561px]:p-8" aria-label={title} data-testid="vm-empty">
      <h2 className="t-h3">{title}</h2>
      <p className="mt-2 text-fg2" data-testid="vm-empty-reason">
        {reason}
      </p>
      {children}
    </section>
  );
}

/** Freshness line: stale notice with the age, the source, and a clear label when the data is recorded fixture data. */
export function VmFreshness({
  stale,
  ageMs,
  fixtures,
  asOf,
}: {
  stale: boolean;
  ageMs: number | null;
  /** Kept so call sites need not change; the source is no longer shown. */
  source?: string | null;
  fixtures: boolean;
  asOf?: string | null;
}) {
  const age = ageText(ageMs);
  return (
    <div className="grid gap-1" data-testid="vm-freshness">
      {fixtures ? (
        <p className="t-meta flex items-center gap-2 text-amber" data-testid="vm-fixture-label">
          <FlaskConical size={14} aria-hidden /> Recorded fixture data, not live.
        </p>
      ) : null}
      {stale ? (
        <p
          className="t-meta flex items-center gap-2 text-amber"
          role="status"
          data-testid="vm-stale"
        >
          <Clock size={14} aria-hidden /> Last update {age ?? "a while ago"}; retrying.
        </p>
      ) : age ? (
        <p className="t-meta">Last update {age}.</p>
      ) : null}
      {asOf ? <p className="t-meta">As of {new Date(asOf).toUTCString()}.</p> : null}
    </div>
  );
}

/** Dollar strings and share strings arrive already formatted; a missing number reads "-", never a guess. */
export const usd = (s: string | null | undefined) =>
  s === null || s === undefined || s === "-" || s === "unavailable" ? "-" : `$${s}`;
export const sharesStr = (s: string | null | undefined) =>
  s === null || s === undefined || s === "unavailable" || s === "-" ? "-" : s;
