// The statement feed lists only the tokens its (truncated) registry knows, so it can miss tokens a wallet really holds and its
// total can read $0 while the wallet is not empty. The chain read (`/api/portfolio`) sees every tokenized stock, so its tokens that
// the feed lacks are folded into the feed's own groups: one list, one total, no separate section.

import type { PortfolioReport } from "@tally/engine";
import type {
  HeadlineHoldingVM,
  IssuerHoldingVM,
  PortfolioVM,
} from "@/modules/statement/view-model";

type Part = PortfolioReport["groups"][number]["parts"][number];

const num = (s: string | null | undefined) => {
  const n = Number.parseFloat(s ?? "");
  return Number.isFinite(n) ? n : 0;
};
const money = (n: number) => n.toFixed(2);

function issuerRow(p: Part, price: number | null): IssuerHoldingVM {
  const tokens = String(Number(p.tokens.toFixed(6)));
  const shares = String(Number(p.shares.toFixed(6)));
  return {
    issuer: p.issuer,
    tokenSymbol: p.symbol,
    tokenContractAddress: p.address,
    balanceTokens: tokens,
    multiplier: String(Number(p.multiplier.toFixed(6))),
    balanceShares: shares,
    convertedAtTodaysRatio: false,
    valueUsd: p.valueUsd === null ? "-" : money(p.valueUsd),
    pricePerShareUsd: price === null ? "-" : money(price),
    rowActionsSlot: {
      token: p.address,
      issuer: p.issuer,
      balanceTokens: tokens,
      balanceShares: shares,
      ticker: p.ticker,
    },
  };
}

/** The view model with the chain's tokens that it lacks added to their stock's group (or as new groups), and the total redone. */
export function mergeChainHoldings(
  vm: PortfolioVM,
  chain: Pick<PortfolioReport, "groups"> | null,
): PortfolioVM {
  if (!chain) return vm;
  const known = new Set(
    vm.holdings.flatMap((g) => g.issuers.map((i) => i.tokenContractAddress.toLowerCase())),
  );
  const holdings: HeadlineHoldingVM[] = vm.holdings.map((g) => ({ ...g, issuers: [...g.issuers] }));
  let added = 0;
  for (const cg of chain.groups) {
    for (const p of cg.parts) {
      if (known.has(p.address.toLowerCase())) continue;
      const row = issuerRow(p, cg.referencePrice);
      let g = holdings.find((h) => h.ticker === cg.ticker);
      if (!g) {
        g = {
          ticker: cg.ticker,
          totalShares: "0",
          totalValueUsd: "0.00",
          avgCostPerShareUsd: "-",
          unrealizedPnlUsd: "-",
          unrealizedPnlPercent: "-",
          issuers: [],
          rowActionsSlot: row.rowActionsSlot,
        };
        holdings.push(g);
      }
      g.issuers.push(row);
      g.totalShares = String(Number((num(g.totalShares) + p.shares).toFixed(6)));
      g.totalValueUsd = money(num(g.totalValueUsd) + (p.valueUsd ?? 0));
      added += p.valueUsd ?? 0;
    }
  }
  if (
    holdings.length === vm.holdings.length &&
    holdings.every((h, i) => h.issuers.length === vm.holdings[i]!.issuers.length)
  )
    return vm;
  return {
    ...vm,
    state: "ready",
    holdings,
    totalValueUsd: money(num(vm.totalValueUsd) + added),
    reason: null,
  };
}
