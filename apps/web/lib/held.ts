import type { PortfolioReport } from "@tally/engine";

/**
 * `&held=NVDA,AAPL` for `/api/vm/portfolio`: the stocks the wallet holds right now, from the chain read. Suggestions follow this, so
 * they are right the moment a sale or a buy is confirmed instead of after the statement worker's next run. Balances under $1 are
 * dust and do not count. An empty list is sent as `held=` (the wallet holds nothing).
 */
export function heldQuery(chain: Pick<PortfolioReport, "groups"> | null | undefined): string {
  if (!chain) return "";
  const held = chain.groups
    .filter((g) => g.valueUsd === null || g.valueUsd >= 1)
    .map((g) => g.ticker);
  return `&held=${encodeURIComponent([...new Set(held)].join(","))}`;
}
