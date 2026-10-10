// Percent maths for the basket page: weights are typed as percent text and handled as whole basis points (10,000 = 100%).

/** "20", "33.33" and ".5" are valid (at most two decimals, up to 100); anything else is not. */
export function percentToBps(text: string): number | null {
  const t = text.trim();
  if (!/^(\d{1,3}(\.\d{0,2})?|\.\d{1,2})$/.test(t)) return null;
  const bps = Math.round(Number(t) * 100);
  return bps >= 0 && bps <= 10_000 ? bps : null;
}

export const bpsToPercent = (bps: number): string => String(Number((bps / 100).toFixed(2)));

/** The same weight for every token; the remainder of the division goes to the first tokens, one basis point each. */
export function equalWeights(tickers: readonly string[]): Record<string, number> {
  const n = tickers.length;
  if (n === 0) return {};
  const base = Math.floor(10_000 / n);
  const extra = 10_000 - base * n;
  return Object.fromEntries(tickers.map((t, i) => [t, base + (i < extra ? 1 : 0)]));
}

/** Scales the weights so they total exactly 100%; the rounding remainder goes to the largest weight. Null when all are zero. */
export function normaliseWeights(
  weights: Readonly<Record<string, number>>,
): Record<string, number> | null {
  const entries = Object.entries(weights);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  if (total <= 0) return null;
  const scaled = entries.map(([t, w]) => [t, Math.floor((w * 10_000) / total)] as const);
  const remainder = 10_000 - scaled.reduce((a, [, w]) => a + w, 0);
  const largest = scaled.reduce((best, cur, i) => (cur[1] > scaled[best]![1] ? i : best), 0);
  return Object.fromEntries(scaled.map(([t, w], i) => [t, i === largest ? w + remainder : w]));
}
