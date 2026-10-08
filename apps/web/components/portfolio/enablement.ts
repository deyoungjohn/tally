import { isTokenBuyable, issuersOf } from "@/lib/tickers";

/** Migrate moves a holding between the two issuers, so it needs both enabled for the stock. */
export const canMigrateTicker = (ticker: string) => issuersOf(ticker).length >= 2;

/** The held token the "Buy more" link names: the largest holding whose issuer is enabled for buying, or undefined (no link). */
export function buyMoreToken<T extends { issuer: string; valueUsd: number }>(
  ticker: string,
  parts: readonly T[],
): T | undefined {
  return [...parts]
    .filter(
      (p) => (p.issuer === "ondo" || p.issuer === "bstock") && isTokenBuyable(ticker, p.issuer),
    )
    .sort((a, b) => b.valueUsd - a.valueUsd)[0];
}
