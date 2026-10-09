// The statement feed lists only the tokens its (truncated) registry knows, so it can miss tokens a wallet really holds and its
// total can read $0 while the wallet is not empty. The chain read (`/api/portfolio`) sees every tokenized stock, so its tokens that
// the feed lacks are folded into the feed's own groups: one list, one total, no separate section.

import type { PortfolioReport } from "@tally/engine";
import { BUYABLE_TICKERS } from "@/lib/tickers";
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

/** Tickers the chain read looked at for sure: the stocks the picker covers (always read) and every one it found. */
function readTickers(chain: Pick<PortfolioReport, "groups" | "failed">): Set<string> {
  const read = new Set<string>(BUYABLE_TICKERS.map((t) => t.ticker));
  for (const g of chain.groups) read.add(g.ticker);
  for (const f of chain.failed ?? []) read.delete(f.ticker);
  return read;
}

/**
 * The view model, made current by the chain read. The feed (rebuilt every few minutes) is right about cost, but the chain is right
 * about what the wallet holds this second, so: a token the chain sees takes the chain's balance and value; a token the feed lists
 * that the chain no longer sees (sold out) drops to zero and disappears; a token the feed lacks is added to its stock's group (or as a
 * new group). Totals are then the sum of what is left. Stocks the chain read failed on are left as the feed has them.
 */
export function mergeChainHoldings(
  vm: PortfolioVM,
  chain: Pick<PortfolioReport, "groups" | "failed"> | null,
): PortfolioVM {
  if (!chain || vm.state === "error") return vm;
  const byAddress = new Map<string, { part: Part; price: number | null }>();
  for (const cg of chain.groups)
    for (const p of cg.parts)
      byAddress.set(p.address.toLowerCase(), { part: p, price: cg.referencePrice });
  const read = readTickers(chain);
  const holdings: HeadlineHoldingVM[] = vm.holdings.map((g) => {
    let changed = false;
    const issuers = g.issuers.map((i) => {
      const hit = byAddress.get(i.tokenContractAddress.toLowerCase());
      if (hit) {
        changed = true;
        byAddress.delete(i.tokenContractAddress.toLowerCase());
        const row = issuerRow(hit.part, hit.price);
        return { ...i, ...row, rowActionsSlot: row.rowActionsSlot };
      }
      if (read.has(g.ticker) && Number.parseFloat(i.balanceTokens) !== 0) {
        changed = true;
        return {
          ...i,
          balanceTokens: "0",
          balanceShares: "0",
          valueUsd: "0.00",
          rowActionsSlot: { ...i.rowActionsSlot, balanceTokens: "0", balanceShares: "0" },
        };
      }
      return i;
    });
    return changed ? { ...g, issuers } : g;
  });
  let added = false;
  for (const { part: p, price } of byAddress.values()) {
    const row = issuerRow(p, price);
    let g = holdings.find((h) => h.ticker === p.ticker);
    if (!g) {
      g = {
        ticker: p.ticker,
        totalShares: "0",
        totalValueUsd: "0.00",
        avgCostPerShareUsd: "-",
        unrealizedPnlUsd: "-",
        unrealizedPnlPercent: "-",
        issuers: [],
        rowActionsSlot: row.rowActionsSlot,
      };
      holdings.push(g);
    } else {
      // The feed's cost basis does not cover a token it never saw, so the stock's cost lines would be wrong: they are left out.
      g.avgCostPerShareUsd = "-";
      g.unrealizedPnlUsd = "-";
      g.unrealizedPnlPercent = "-";
    }
    g.issuers.push(row);
    added = true;
  }
  // Totals from what is left. A stock whose shares are unknown for a token keeps the feed's own share total.
  const withTotals = holdings.map((g) => {
    if (!added && g === vm.holdings.find((h) => h.ticker === g.ticker)) return g;
    const shares = g.issuers.reduce(
      (a, i) => a + (i.balanceShares === "unavailable" ? 0 : num(i.balanceShares)),
      0,
    );
    const value = g.issuers.reduce((a, i) => a + num(i.valueUsd), 0);
    return { ...g, totalShares: String(Number(shares.toFixed(6))), totalValueUsd: money(value) };
  });
  const total = withTotals.reduce((a, g) => a + num(g.totalValueUsd), 0);
  return { ...vm, state: "ready", holdings: withTotals, totalValueUsd: money(total), reason: null };
}

/** The chain's tokens the feed has no record of at all, for the Statement tab. */
export function untrackedTokens(
  vm: PortfolioVM,
  chain: Pick<PortfolioReport, "groups"> | null,
): {
  key: string;
  symbol: string;
  ticker: string;
  issuer: "ondo" | "bstock" | "xstocks";
  address: string;
  shares: string;
  /** Token count and shares per token, to turn a transferred token amount into shares. */
  tokens: number;
  sharesPerToken: number;
  valueUsd: string;
}[] {
  if (!chain) return [];
  const known = new Set(
    vm.holdings.flatMap((g) => g.issuers.map((i) => i.tokenContractAddress.toLowerCase())),
  );
  return chain.groups
    .flatMap((g) => g.parts)
    .filter((p) => !known.has(p.address.toLowerCase()))
    .map((p) => ({
      key: p.address,
      symbol: p.symbol,
      ticker: p.ticker,
      issuer: p.issuer,
      address: p.address,
      shares: String(Number(p.shares.toFixed(6))),
      tokens: p.tokens,
      sharesPerToken: p.tokens > 0 ? p.shares / p.tokens : 0,
      valueUsd: money(p.valueUsd ?? 0),
    }));
}
