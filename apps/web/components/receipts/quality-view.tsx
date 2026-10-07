"use client";
// Execution quality from the receipts module's `QualityVM`: how fills compare with quotes, by issuer and by route length.
// Statistics use verified comparisons only; pending attempts and browser-reported comparisons are counted and excluded.

import { Tip } from "@/components/ui/tooltip";
import type { QualityRow } from "@tally/mod-receipts";
import type { QualityVM } from "@/modules/quality/view-model";
import { ISSUER_LABEL } from "@/lib/format";
import { VmEmpty, VmFreshness } from "@/components/portfolio/vm-shared";

const pct = (v: number | null) => (v === null ? "unavailable" : `${(v * 100).toFixed(1)}%`);
const bps = (v: number | null) => (v === null ? "unavailable" : `${v > 0 ? "+" : ""}${v} bps`);

function Row({ label, row }: { label: string; row: QualityRow }) {
  const thin = row.insufficient;
  return (
    <tr data-testid={`quality-row-${label}`}>
      <th scope="row" className="py-2 pr-3 text-left font-semibold">
        {label}
      </th>
      <td className="py-2 pr-3">{row.n}</td>
      <td className="py-2 pr-3">{thin ? "Not enough data" : pct(row.fillRate)}</td>
      <td className="py-2 pr-3">{thin ? "Not enough data" : bps(row.vsQuote.medianBps)}</td>
      <td className="py-2 pr-3">{thin ? "Not enough data" : bps(row.vsQuote.p90Bps)}</td>
      <td className="py-2 pr-3">{thin ? "Not enough data" : bps(row.vsSimulation.medianBps)}</td>
      <td className="py-2">{thin ? "Not enough data" : bps(row.vsReference.medianBps)}</td>
    </tr>
  );
}

export function QualityView({ vm, fixtures }: { vm: QualityVM; fixtures: boolean }) {
  if (vm.state === "error" || vm.state === "disabled")
    return <VmEmpty title="Quality is unavailable" reason={vm.reason ?? "Couldn't load."} />;
  if (vm.state === "empty")
    return (
      <VmEmpty
        title="No fills recorded yet"
        reason={vm.reason ?? "Quality has no observations yet."}
      />
    );
  const r = vm.report;
  return (
    <>
      <p className="t-meta" data-testid="quality-counts">
        {vm.pendingCount} pending attempts are excluded ({vm.unverifiedPendingCount} awaiting chain
        verification). {r.unverifiedComparisonCount} comparisons reported by browsers are excluded
        from these statistics.
      </p>
      {vm.insufficient ? (
        <p
          className="mt-3 rounded-xl border border-line p-4 text-fg2"
          role="status"
          data-testid="quality-insufficient"
        >
          {vm.reason ?? "Fewer than 5 fills with verified comparisons."} Numbers appear per row once
          it has 5 or more.
        </p>
      ) : null}
      <div className="mt-4">
        <VmFreshness stale={vm.stale} ageMs={vm.ageMs} source={vm.source} fixtures={fixtures} />
      </div>
      <div className="mt-4 overflow-x-auto" tabIndex={0} aria-label="Execution quality table">
        <table className="w-full min-w-[640px] border-collapse text-[14.5px]">
          <thead>
            <tr className="t-meta text-left">
              <th className="pb-2 pr-3">Issuer / route hops</th>
              <th className="pb-2 pr-3">Fills</th>
              <th className="pb-2 pr-3">
                <Tip text="Fills that reconciled, out of attempts that finished. Pending attempts are not counted.">
                  Fill rate
                </Tip>
              </th>
              <th className="pb-2 pr-3">
                <Tip text="Received amount against the quote, median. Negative means less than quoted.">
                  Vs quote (median)
                </Tip>
              </th>
              <th className="pb-2 pr-3">Vs quote (p90)</th>
              <th className="pb-2 pr-3">Vs simulation (median)</th>
              <th className="pb-2">Vs US price (median)</th>
            </tr>
          </thead>
          <tbody>
            {r.byIssuer.map((row) => (
              <Row key={row.issuer} label={ISSUER_LABEL[row.issuer] ?? row.issuer} row={row} />
            ))}
            {r.byRouteLength.map((row) => (
              <Row
                key={row.routeLength ?? "unknown"}
                label={
                  row.routeLength === null ? "Unknown route length" : `${row.routeLength} hops`
                }
                row={row}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="t-meta mt-4">
        The US price comparison needs a historical US reference and the spend token&apos;s USD value
        to both be recorded; no stablecoin peg is assumed.
      </p>
      {vm.truncated ? (
        <p className="t-meta mt-1">Showing up to 1000 latest observations per kind.</p>
      ) : null}
    </>
  );
}
