// The statement is rebuilt every few minutes, so a buy or sale that just confirmed is not in it yet. Activity already knows it (the
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
    if (r.status !== "RECONCILED" && r.status !== "RECONCILED_WITH_DIFFERENCE") continue;
    if (!r.ticker || !r.issuer || knownHashes.has(r.txHash.toLowerCase())) continue;
    const received = r.ladder.find((s) => s.stage === "Received");
    const quoted = r.ladder.find((s) => s.stage === "Quoted");
    const sell = r.kind === "sell";
    const shares = sell ? quoted?.shares : received?.shares;
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
