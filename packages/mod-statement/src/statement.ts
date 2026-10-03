import { formatUnits } from "@tally/core";
import type {
  Statement,
  Holding,
  Trade,
  PnlLine,
  StatementReceipt,
  TickerHoldingsGroup,
} from "./types";

export interface StatementOptions {
  walletAddress: string;
  holdings?: Holding[];
  trades?: Trade[];
  pnlLines?: PnlLine[];
  receipts?: StatementReceipt[];
  pricesByTicker?: Record<string, number>;
  asOf?: number;
  apiFailed?: boolean;
  apiError?: string;
}

/** Calculate realized P&L from a list of receipts using average cost matching */
function calculateReceiptsRealizedPnl(receipts: StatementReceipt[]): number {
  const buyPoolByTicker: Record<string, { totalShares: bigint; totalCostUsd: number }> = {};
  let totalRealizedPnl = 0;

  // Sort receipts chronologically
  const sorted = [...receipts].sort((a, b) => a.executedAt - b.executedAt);

  for (const r of sorted) {
    if (r.status === "FAILED") continue;
    const ticker = r.ticker.toUpperCase();
    if (!buyPoolByTicker[ticker]) {
      buyPoolByTicker[ticker] = { totalShares: 0n, totalCostUsd: 0 };
    }

    if (r.side === "BUY") {
      buyPoolByTicker[ticker]!.totalShares += r.shares;
      buyPoolByTicker[ticker]!.totalCostUsd += r.usdSpentOrReceived;
    } else if (r.side === "SELL") {
      const pool = buyPoolByTicker[ticker]!;
      const poolSharesNum = Number(formatUnits(pool.totalShares, 18));
      const avgCostPerShare = poolSharesNum > 0 ? pool.totalCostUsd / poolSharesNum : 0;
      const sellSharesNum = Number(formatUnits(r.shares, 18));
      const costOfSoldShares = sellSharesNum * avgCostPerShare;
      const proceeds = r.usdSpentOrReceived;
      const pnl = proceeds - costOfSoldShares;
      totalRealizedPnl += pnl;

      // Deduct from pool
      pool.totalShares = pool.totalShares > r.shares ? pool.totalShares - r.shares : 0n;
      pool.totalCostUsd = Math.max(0, pool.totalCostUsd - costOfSoldShares);
    }
  }

  return totalRealizedPnl;
}

/** Synthesize holdings and trades from receipts when API is unavailable */
function synthesizeFromReceipts(
  receipts: StatementReceipt[],
  pricesByTicker: Record<string, number> = {},
): { holdings: Holding[]; trades: Trade[] } {
  const tokenMap: Record<
    string,
    {
      tokenContractAddress: string;
      tokenSymbol: string;
      ticker: string;
      issuer: Holding["issuer"];
      balanceTokens: bigint;
      balanceShares: bigint;
      multiplier: bigint;
      costBasisUsd: number;
    }
  > = {};

  const sorted = [...receipts].sort((a, b) => a.executedAt - b.executedAt);
  const trades: Trade[] = [];

  for (const r of sorted) {
    if (r.status === "FAILED") continue;
    const key = r.tokenContractAddress.toLowerCase();
    if (!tokenMap[key]) {
      tokenMap[key] = {
        tokenContractAddress: key,
        tokenSymbol: r.tokenSymbol,
        ticker: r.ticker.toUpperCase(),
        issuer: r.issuer,
        balanceTokens: 0n,
        balanceShares: 0n,
        multiplier: r.multiplier,
        costBasisUsd: 0,
      };
    }

    const t = tokenMap[key]!;
    t.multiplier = r.multiplier;

    const sharesNum = Number(formatUnits(r.shares, 18));
    const pricePerShare = sharesNum > 0 ? r.usdSpentOrReceived / sharesNum : 0;
    const multNum = Number(formatUnits(r.multiplier, 18));
    const pricePerToken = multNum > 0 ? pricePerShare * multNum : pricePerShare;

    trades.push({
      txHash: r.txHash ?? `receipt-${r.id}`,
      time: r.executedAt,
      type: r.side,
      tokenContractAddress: key,
      tokenSymbol: r.tokenSymbol,
      ticker: r.ticker.toUpperCase(),
      issuer: r.issuer,
      amountTokens: r.tokens,
      multiplier: r.multiplier,
      amountShares: r.shares,
      convertedAtTodaysRatio: false,
      pricePerTokenUsd: pricePerToken,
      pricePerShareUsd: pricePerShare,
      valueUsd: r.usdSpentOrReceived,
    });

    if (r.side === "BUY") {
      t.balanceTokens += r.tokens;
      t.balanceShares += r.shares;
      t.costBasisUsd += r.usdSpentOrReceived;
    } else if (r.side === "SELL") {
      const prevSharesNum = Number(formatUnits(t.balanceShares, 18));
      const avgCost = prevSharesNum > 0 ? t.costBasisUsd / prevSharesNum : 0;
      t.balanceTokens = t.balanceTokens > r.tokens ? t.balanceTokens - r.tokens : 0n;
      t.balanceShares = t.balanceShares > r.shares ? t.balanceShares - r.shares : 0n;
      t.costBasisUsd = Math.max(0, t.costBasisUsd - sharesNum * avgCost);
    }
  }

  const holdings: Holding[] = Object.values(tokenMap).map((item) => {
    const sharesNum = Number(formatUnits(item.balanceShares, 18));
    const pricePerShareUsd =
      pricesByTicker[item.ticker] ?? (sharesNum > 0 ? item.costBasisUsd / sharesNum : 0);
    const tokenBalanceUsd = sharesNum * pricePerShareUsd;
    const avgCostPerShareUsd = sharesNum > 0 ? item.costBasisUsd / sharesNum : 0;
    const unrealizedPnlUsd = tokenBalanceUsd - item.costBasisUsd;
    const unrealizedPnlPercent =
      item.costBasisUsd > 0 ? (unrealizedPnlUsd / item.costBasisUsd) * 100 : 0;

    return {
      tokenContractAddress: item.tokenContractAddress,
      tokenSymbol: item.tokenSymbol,
      ticker: item.ticker,
      issuer: item.issuer,
      balanceTokens: item.balanceTokens,
      multiplier: item.multiplier,
      balanceShares: item.balanceShares,
      convertedAtTodaysRatio: false,
      tokenBalanceUsd,
      pricePerShareUsd,
      costBasisUsd: item.costBasisUsd,
      avgCostPerShareUsd,
      unrealizedPnlUsd,
      unrealizedPnlPercent,
      source: "receipts",
    };
  });

  return { holdings, trades };
}

/**
 * statement():
 * Computes portfolio statement aggregating holdings in shares per ticker across issuers,
 * average cost per share, realized and unrealized P&L, reconciliation against receipts (>1% discrepancy flag),
 * and graceful fallback when API fails.
 */
export function statement(options: StatementOptions): Statement {
  const { walletAddress, pricesByTicker = {}, asOf = Date.now(), apiFailed = false } = options;

  let holdings = options.holdings ?? [];
  let trades = options.trades ?? [];
  const pnlLines = options.pnlLines ?? [];
  const receipts = options.receipts ?? [];
  const notes: string[] = [];
  let source: "api" | "receipts" | "mixed" = "api";

  // Check if API failed or returned nothing while receipts exist
  const hasApiData = holdings.length > 0 || trades.length > 0 || pnlLines.length > 0;
  const isApiUnavailable = apiFailed || (!hasApiData && receipts.length > 0);

  if (isApiUnavailable && receipts.length > 0) {
    const synthesized = synthesizeFromReceipts(receipts, pricesByTicker);
    holdings = synthesized.holdings;
    trades = synthesized.trades;
    source = "receipts";
    notes.push("Generated from on-chain receipts only (Binance API unavailable).");
  } else if (receipts.length > 0 && hasApiData) {
    source = "mixed";
  }

  // Count conversions at today's ratio
  let convertedAtTodaysRatioCount = 0;
  for (const h of holdings) {
    if (h.convertedAtTodaysRatio) convertedAtTodaysRatioCount++;
  }
  for (const t of trades) {
    if (t.convertedAtTodaysRatio) convertedAtTodaysRatioCount++;
  }
  if (convertedAtTodaysRatioCount > 0) {
    notes.push(
      `${convertedAtTodaysRatioCount} transaction(s) or holding(s) converted at today's ratio (no multiplier observation recorded at trade time).`,
    );
  }

  // Group holdings by ticker across issuers
  const holdingsByTicker: Record<string, TickerHoldingsGroup> = {};

  for (const h of holdings) {
    const ticker = h.ticker.toUpperCase();
    if (!holdingsByTicker[ticker]) {
      holdingsByTicker[ticker] = {
        ticker,
        totalShares: 0n,
        totalValueUsd: 0,
        totalCostBasisUsd: 0,
        avgCostPerShareUsd: 0,
        unrealizedPnlUsd: 0,
        unrealizedPnlPercent: 0,
        issuers: [],
      };
    }
    const group = holdingsByTicker[ticker]!;
    group.totalShares += h.balanceShares;
    group.totalValueUsd += h.tokenBalanceUsd;
    group.totalCostBasisUsd += h.costBasisUsd;
    group.issuers.push(h);
  }

  // Compute average cost per share and unrealized PnL for each ticker group
  for (const group of Object.values(holdingsByTicker)) {
    const totalSharesNum = Number(formatUnits(group.totalShares, 18));
    group.avgCostPerShareUsd = totalSharesNum > 0 ? group.totalCostBasisUsd / totalSharesNum : 0;
    group.unrealizedPnlUsd = group.totalValueUsd - group.totalCostBasisUsd;
    group.unrealizedPnlPercent =
      group.totalCostBasisUsd > 0 ? (group.unrealizedPnlUsd / group.totalCostBasisUsd) * 100 : 0;
  }

  // Calculate totals
  const totalValueUsd = Object.values(holdingsByTicker).reduce(
    (acc, g) => acc + g.totalValueUsd,
    0,
  );
  const totalCostBasisUsd = Object.values(holdingsByTicker).reduce(
    (acc, g) => acc + g.totalCostBasisUsd,
    0,
  );
  const totalUnrealizedPnlUsd = totalValueUsd - totalCostBasisUsd;

  // Realized P&L
  let apiRealizedPnl = 0;
  if (pnlLines.length > 0) {
    apiRealizedPnl = pnlLines.reduce((acc, l) => acc + l.realizedPnlUsd, 0);
  } else if (trades.length > 0) {
    apiRealizedPnl = trades.reduce((acc, t) => acc + (t.realizedPnlUsd ?? 0), 0);
  }

  let totalRealizedPnlUsd = apiRealizedPnl;
  let differsFromApi = false;
  let differsFromApiNote: string | undefined;

  // Reconcile with receipts if available
  if (receipts.length > 0) {
    const receiptsRealizedPnl = calculateReceiptsRealizedPnl(receipts);

    if (source !== "receipts") {
      const diff = Math.abs(apiRealizedPnl - receiptsRealizedPnl);
      const denom = Math.max(Math.abs(apiRealizedPnl), Math.abs(receiptsRealizedPnl), 1);
      const diffFraction = diff / denom;

      if (diffFraction > 0.01) {
        differsFromApi = true;
        differsFromApiNote = `Realized P&L differs from Binance API figure by ${(diffFraction * 100).toFixed(2)}% (Receipts: $${receiptsRealizedPnl.toFixed(2)} vs API: $${apiRealizedPnl.toFixed(2)}). Using share-true receipts.`;
        notes.push(differsFromApiNote);
        totalRealizedPnlUsd = receiptsRealizedPnl;
      }
    } else {
      totalRealizedPnlUsd = receiptsRealizedPnl;
    }
  }

  return {
    walletAddress,
    asOf,
    holdingsByTicker,
    holdings,
    trades,
    pnlLines,
    totalValueUsd,
    totalCostBasisUsd,
    totalRealizedPnlUsd,
    totalUnrealizedPnlUsd,
    differsFromApi,
    differsFromApiNote,
    convertedAtTodaysRatioCount,
    notes,
    source,
  };
}
