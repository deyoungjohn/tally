// The statement is rebuilt every few minutes, so a buy or sell that just confirmed is not in it yet. Activity already knows it (the
// receipts are recorded as they happen), so the Statement tab adds those verified transactions at the top, marked as recent, until the
// feed has them. A buy's dollar value is not recorded on its receipt, so it reads unknown rather than a guess.

import type { StatementLineVM } from "@/modules/statement/view-model";
import type { ActivityVM } from "@/modules/receipts/view-model";

const digits = (v: string | null | undefined, max = 6) => {
  const n = Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? String(Number(n.toFixed(max))) : "unavailable";
};

export function recentLines(
  activity: ActivityVM | null | undefined,
  knownHashes: Set<string>,
): StatementLineVM[] {
  if (!activity) return [];
  const out: StatementLineVM[] = [];
  for (const r of activity.items) {
    if (r.kind !== "swap" && r.kind !== "sell") continue;
    // Mined and not failed: a transaction the chain confirmed belongs here even when Tally's own amount check is still running
    // (its amounts then read "-"). Only pending and failed ones stay out.
    if (r.status === "PENDING" || r.status === "FAILED" || r.status === null) continue;
    if (!r.ticker || !r.issuer || knownHashes.has(r.txHash.toLowerCase())) continue;
    const received = r.ladder.find((s) => s.stage === "Received");
    const quoted = r.ladder.find((s) => s.stage === "Quoted");
    const sell = r.kind === "sell";
    // A sell's verified shares sold are on its Received step (the USDT is in `tokens`); the Quoted step has no shares.
    const shares = received?.shares;
    const tokens = sell ? quoted?.tokens : received?.tokens;
    const value = sell ? received?.tokens : null;
    const sharesN = Number.parseFloat(shares ?? "");
    const valueN = Number.parseFloat(value ?? "");
    out.push({
      date: r.observedAt ?? new Date().toISOString(),
      ticker: r.ticker,
      issuer: r.issuer,
      type: sell ? "SELL" : "BUY",
      amountTokens: digits(tokens),
      multiplier: "unavailable",
      amountShares: digits(shares),
      pricePerShareUsd:
        Number.isFinite(valueN) && sharesN > 0 ? (valueN / sharesN).toFixed(2) : "-",
      valueUsd: Number.isFinite(valueN) ? valueN.toFixed(2) : "-",
      convertedAtTodaysRatio: false,
      txHash: r.txHash,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
