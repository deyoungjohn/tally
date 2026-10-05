import { ModuleBoundary } from "../../components/module-boundary";
import { loadQuality, type QualityVM } from "./view-model";
import type { QualityRow } from "@tally/mod-receipts";
function Row({ label, row }: { label: string; row: QualityRow }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{row.n}</td>
      <td>{row.fillRate === null ? "Unavailable" : `${(row.fillRate * 100).toFixed(1)}%`}</td>
      <td>{row.vsQuote.medianBps ?? "Unavailable"}</td>
      <td>{row.vsQuote.p90Bps ?? "Unavailable"}</td>
      <td>{row.vsSimulation.medianBps ?? "Unavailable"}</td>
      <td>{row.vsReference.medianBps ?? "Unavailable"}</td>
      <td>{row.insufficient ? "Insufficient data (n < 5)" : "Available"}</td>
    </tr>
  );
}
export function QualityContent({ vm }: { vm: QualityVM }) {
  if (vm.state === "disabled") return null;
  return (
    <section aria-label="Quality">
      <h2>Execution quality</h2>
      {vm.reason && <p>{vm.reason}</p>}
      {vm.insufficient && <p>Insufficient data: fewer than 5 fills with verified comparisons.</p>}
      <p>
        {vm.pendingCount} pending attempts excluded ({vm.unverifiedPendingCount} awaiting chain
        verification).
      </p>
      <p>
        {vm.report.unverifiedComparisonCount} client-reported comparisons excluded from verified
        statistics.
      </p>
      {vm.stale && <p>Last verification is stale.</p>}
      <p>Source: {vm.source ?? "No observations"}</p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Issuer / route hops</th>
              <th>Fills</th>
              <th>Fill rate</th>
              <th>Quote median bps</th>
              <th>Quote p90 bps</th>
              <th>Simulation median bps</th>
              <th>US reference median bps</th>
              <th>Sample</th>
            </tr>
          </thead>
          <tbody>
            {vm.report.byIssuer.map((r) => (
              <Row key={r.issuer} label={r.issuer} row={r} />
            ))}
            {vm.report.byRouteLength.map((r) => (
              <Row
                key={r.routeLength ?? "unknown"}
                label={r.routeLength === null ? "Unknown route length" : `${r.routeLength} hops`}
                row={r}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Historical US reference and spend-token USD valuation must both be recorded; no stablecoin
        peg is assumed.
      </p>
      {vm.truncated && <p>Showing up to 1000 latest observations per kind.</p>}
    </section>
  );
}
export async function QualityPlain() {
  if (process.env.FEATURE_QUALITY !== "1") return null;
  const content = <QualityContent vm={await loadQuality()} />;
  return <ModuleBoundary module="quality" fallback={content} load={async () => content} />;
}
