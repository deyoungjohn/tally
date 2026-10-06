import { E18, mulDiv, parseDecimal } from "@tally/core";
import type { MissingFact, PieHolding, PiePrices, PieTemplate, PieValue } from "./types";

/** Authenticated referencePrice is per TOKEN; divide by the recorded tokenToShareRatio. */
export function referencePerShare(input: {
  referencePrice?: string | null;
  tokenToShareRatio?: string | null;
}): { usdPerShareE18: bigint | null; reason?: string } {
  if (input.referencePrice == null)
    return { usdPerShareE18: null, reason: "Reference price unavailable" };
  if (input.tokenToShareRatio == null)
    return { usdPerShareE18: null, reason: "Token-to-share ratio unavailable" };
  try {
    const price = parseDecimal(input.referencePrice, 18);
    const ratio = parseDecimal(input.tokenToShareRatio, 18);
    if (price <= 0n || ratio <= 0n) throw new Error("Reference price and ratio must be positive");
    const usdPerShareE18 = mulDiv(price, E18, ratio);
    if (usdPerShareE18 <= 0n) throw new Error("Per-share reference price rounds to zero");
    return { usdPerShareE18 };
  } catch (error) {
    return { usdPerShareE18: null, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Exact proportional allocation, largest remainder first; ties retain input order. */
export function allocateExact(total: bigint, weights: readonly bigint[]): bigint[] {
  if (total < 0n || weights.some((w) => w < 0n))
    throw new RangeError("Allocation must be nonnegative");
  const sum = weights.reduce((n, w) => n + w, 0n);
  if (sum === 0n) {
    if (total !== 0n) throw new RangeError("Cannot allocate without positive weights");
    return weights.map(() => 0n);
  }
  const out = weights.map((w) => mulDiv(total, w, sum));
  let remainder = total - out.reduce((n, w) => n + w, 0n);
  const ranked = weights
    .map((w, i) => ({ i, rem: (total * w) % sum }))
    .sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const row of ranked) {
    if (remainder === 0n) break;
    out[row.i] = out[row.i]! + 1n;
    remainder--;
  }
  return out;
}

export function valuePie(
  template: PieTemplate,
  holdings: readonly PieHolding[],
  prices: PiePrices,
): {
  before: PieValue[];
  totalValueE18: bigint;
  excluded: MissingFact[];
} {
  const excluded: MissingFact[] = [];
  const values = template.holdings.map(({ ticker }) => {
    // Sum SHARES first, so per-issuer integer truncation cannot lose a share-value wei.
    let shares = 0n;
    const price = prices[ticker];
    for (const h of holdings.filter((h) => h.ticker === ticker && h.balanceTokens !== 0n)) {
      if (h.balanceTokens < 0n || (h.balanceShares !== null && h.balanceShares <= 0n)) {
        excluded.push({
          ticker,
          tokenContractAddress: h.tokenContractAddress,
          reason: "Invalid holding balance",
        });
      } else if (h.balanceShares === null) {
        excluded.push({
          ticker,
          tokenContractAddress: h.tokenContractAddress,
          reason: h.sharesUnavailableReason ?? "Share balance unavailable",
        });
      } else shares += h.balanceShares;
    }
    if (!price || price.usdPerShareE18 === null || price.usdPerShareE18 <= 0n) {
      excluded.push({ ticker, reason: price?.reason ?? "Per-share USD price unavailable" });
      return 0n;
    }
    return mulDiv(shares, price.usdPerShareE18, E18);
  });
  const totalValueE18 = values.reduce((n, v) => n + v, 0n);
  const weights = totalValueE18 === 0n ? values.map(() => 0n) : allocateExact(10000n, values);
  return {
    totalValueE18,
    excluded,
    before: template.holdings.map((h, i) => ({
      ticker: h.ticker,
      valueE18: values[i]!,
      weightBps: Number(weights[i]!),
    })),
  };
}
