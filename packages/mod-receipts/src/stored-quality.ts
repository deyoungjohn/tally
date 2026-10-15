import { qualityReport, type QualityReport, type QualityRow, type ReferencePrice } from "./quality";
import type { StoredReceipt } from "./verification";

export interface StoredQualityReport extends QualityReport {
  unverifiedComparisonCount: number;
  approvalCount: number;
  chainReconciledCount: number;
}
/** Browser claims cannot supply public distributions or route-length attribution. Chain fill counts remain useful. */
export function storedQualityReport(
  entries: readonly StoredReceipt[],
  prices: readonly ReferencePrice[] = [],
): StoredQualityReport {
  const swaps = entries.filter((e) => e.kind === "swap" && e.receipt !== null);
  const trusted = swaps.filter((e) => e.baselineTrust === "recorded");
  const receipts = swaps.map((e) => e.receipt!);
  const raw = entries.filter((e) => e.kind === "swap" && !e.receipt);
  const failed = raw.filter((e) => e.chainReceipt?.status === "reverted").length;
  const unreconciled = raw.filter((e) => e.chainReceipt?.status === "success").length;
  const pending = raw.filter((e) => !e.chainReceipt).length;
  const all = qualityReport(receipts, []);
  const verified = qualityReport(
    trusted.map((e) => e.receipt!),
    prices,
  );
  function distributions(row: QualityRow, verifiedRow?: QualityRow): QualityRow {
    const empty = { n: 0, medianBps: null, p90Bps: null, insufficient: true };
    return {
      ...row,
      // `n` counts every fill the chain confirmed (what Live fills shows); the price comparisons below need 5 fills with a
      // server-recorded quote, because a quote a browser reports is never trusted. Counting only the trusted fills here made the
      // page read "0 fills" after any number of real purchases, since every quote arrives from the browser.
      n: row.n,
      insufficient: (verifiedRow?.n ?? 0) < 5,
      vsQuote: verifiedRow?.vsQuote ?? empty,
      vsSimulation: verifiedRow?.vsSimulation ?? empty,
      vsReference: verifiedRow?.vsReference ?? empty,
      notes: [
        ...row.notes,
        "Client-reported comparisons excluded from verified distributions; no USD peg assumed",
      ],
    };
  }
  const unknown = swaps.filter((e) => e.baselineTrust !== "recorded");
  return {
    ...all,
    ...distributions(all, verified),
    pendingCount: all.pendingCount + pending,
    failedCount: all.failedCount + failed,
    unreconciledCount: all.unreconciledCount + unreconciled,
    completedCount: all.completedCount + failed + unreconciled,
    fillRate:
      all.completedCount + failed + unreconciled
        ? all.n / (all.completedCount + failed + unreconciled)
        : null,
    byIssuer: all.byIssuer.map((row) => ({
      ...distributions(
        row,
        verified.byIssuer.find((v) => v.issuer === row.issuer),
      ),
      issuer: row.issuer,
    })),
    // Every fill, grouped by the route length its quote describes (a fill with no route on record stays "unknown"). The counts
    // are fills; the price comparisons stay empty until fills carry a server-recorded quote.
    byRouteLength: all.byRouteLength.map((row) => ({
      ...distributions(
        row,
        verified.byRouteLength.find((v) => v.routeLength === row.routeLength),
      ),
      routeLength: row.routeLength,
    })),
    unverifiedComparisonCount: unknown.filter((e) => e.receipt?.quote !== null).length,
    chainReconciledCount: all.n,
    approvalCount: entries.filter((e) => e.kind === "approval").length,
  };
}
