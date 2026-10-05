import type { Runtime } from "./runtime";

export function freshness(runtime: Runtime, asOf: string, maxAgeMs: number) {
  const timestamp = Date.parse(asOf);
  const ageMs = Number.isFinite(timestamp) ? Math.max(0, runtime.now() - timestamp) : null;
  const stale = ageMs === null || ageMs > maxAgeMs;
  const reason = stale
    ? "Source timestamp is missing or data is older than the freshness limit."
    : null;
  if (stale) runtime.onWarn(reason!);
  return {
    asOf,
    ageMs,
    stale,
    reason,
    source: runtime.fixtures ? "recorded-fixtures" : "tally-engine",
    fixtures: runtime.fixtures,
  };
}
