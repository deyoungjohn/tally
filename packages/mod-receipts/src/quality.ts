import { E18, mulDiv } from "@tally/core";
import type { Issuer } from "@tally/core";
import { differenceBps, reconcile } from "./reconcile";
import type { Receipt, Reconciliation } from "./types";
export interface ReferencePrice {
  /** Links the historical price to this intent, never today's price. */
  intentId: string;
  ticker: string;
  usdPerShareE18: bigint;
  /** Historical USD value of one whole spend token, not an assumed stablecoin peg. */
  spendTokenUsdE18: bigint;
  observationId: string;
  observedAt: number;
  source: string;
}
export interface Distribution {
  n: number;
  medianBps: number | null;
  p90Bps: number | null;
  insufficient: boolean;
}
export interface QualityRow {
  n: number;
  completedCount: number;
  pendingCount: number;
  failedCount: number;
  unreconciledCount: number;
  /** Reconciled fills / completed attempts; pending attempts excluded. */
  fillRate: number | null;
  insufficient: boolean;
  vsQuote: Distribution;
  vsSimulation: Distribution;
  vsReference: Distribution;
  notes: string[];
}
export interface QualityReport extends QualityRow {
  byIssuer: Array<QualityRow & { issuer: Issuer }>;
  byRouteLength: Array<QualityRow & { routeLength: number | null }>;
}
/** Signed bps, arithmetic median and nearest-rank p90; empty samples are unavailable. */
function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const middle = Math.floor(n / 2);
  return {
    n,
    medianBps: !n ? null : n % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    p90Bps: n ? sorted[Math.ceil(n * 0.9) - 1]! : null,
    insufficient: n < 5,
  };
}
type Entry = { receipt: Receipt; result: Reconciliation };
function summarize(entries: Entry[], prices: readonly ReferencePrice[]): QualityRow {
  const quote: number[] = [],
    simulation: number[] = [],
    reference: number[] = [],
    notes: string[] = [];
  let pendingCount = 0,
    failedCount = 0,
    unreconciledCount = 0;
  for (const { receipt, result } of entries) {
    if (result.status === "PENDING") {
      pendingCount++;
      continue;
    }
    if (result.status === "FAILED") {
      failedCount++;
      continue;
    }
    if (result.status === "UNRECONCILED") {
      unreconciledCount++;
      continue;
    }
    if (result.diffVsQuoteBps !== null) quote.push(result.diffVsQuoteBps);
    if (result.diffVsSimBps !== null) simulation.push(result.diffVsSimBps);
    else
      notes.push(
        `${receipt.intent.id}: simulation unavailable (${receipt.simulationMissingReason})`,
      );
    const matches = prices.filter((price) => price.intentId === receipt.intent.id);
    const price = matches.length === 1 ? matches[0] : undefined;
    const spend = receipt.intent.spend;
    if (
      !price ||
      price.ticker !== receipt.intent.ticker ||
      price.usdPerShareE18 <= 0n ||
      price.spendTokenUsdE18 <= 0n ||
      !price.observationId ||
      !price.source ||
      !Number.isFinite(price.observedAt) ||
      !Number.isInteger(spend.decimals) ||
      spend.decimals < 0 ||
      spend.decimals > 255 ||
      spend.raw <= 0n ||
      !result.tokensSpent ||
      !result.sharesReceived ||
      result.sharesReceived <= 0n
    ) {
      notes.push(
        `${receipt.intent.id}: historical US reference or spend valuation missing, ambiguous or invalid`,
      );
      continue;
    }
    const spendUsd = mulDiv(
      result.tokensSpent,
      price.spendTokenUsdE18,
      10n ** BigInt(spend.decimals),
    );
    const fillPrice = mulDiv(spendUsd, E18, result.sharesReceived);
    const diff = differenceBps(fillPrice, price.usdPerShareE18);
    if (diff !== null) reference.push(diff);
  }
  const n = quote.length;
  const completedCount = n + failedCount + unreconciledCount;
  return {
    n,
    completedCount,
    pendingCount,
    failedCount,
    unreconciledCount,
    fillRate: completedCount ? n / completedCount : null,
    insufficient: n < 5,
    vsQuote: distribution(quote),
    vsSimulation: distribution(simulation),
    vsReference: distribution(reference),
    notes,
  };
}
/** Input is one final receipt per intent/transaction (read latest snapshots in the I/O layer). */
export function qualityReport(
  receipts: readonly Receipt[],
  referencePrices: readonly ReferencePrice[],
): QualityReport {
  const entries = receipts.map((receipt) => ({ receipt, result: reconcile(receipt) }));
  const issuers = [...new Set(receipts.map((receipt) => receipt.intent.issuer))].sort();
  const lengths = [...new Set(receipts.map((receipt) => receipt.quote?.route.length ?? null))].sort(
    (a, b) => (a ?? Infinity) - (b ?? Infinity),
  );
  return {
    ...summarize(entries, referencePrices),
    byIssuer: issuers.map((issuer) => ({
      issuer,
      ...summarize(
        entries.filter((entry) => entry.receipt.intent.issuer === issuer),
        referencePrices,
      ),
    })),
    byRouteLength: lengths.map((routeLength) => ({
      routeLength,
      ...summarize(
        entries.filter((entry) => (entry.receipt.quote?.route.length ?? null) === routeLength),
        referencePrices,
      ),
    })),
  };
}
