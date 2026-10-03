import { z } from "zod";
import { parseDecimal, E18, mulDiv, formatUnits } from "@tally/core";
import type { Holding, Trade, PnlLine, Issuer } from "./types";

const numString = z.string().regex(/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/, "not a number string");

/** Helper to extract data from an API envelope { code: ..., data: ... } or return raw */
export function unwrapData(raw: unknown): unknown {
  if (
    raw &&
    typeof raw === "object" &&
    "data" in raw &&
    (raw as { data: unknown }).data !== undefined
  ) {
    return (raw as { data: unknown }).data;
  }
  return raw;
}

/** 1. Recent PnL item and response */
export const recentPnlItemSchema = z
  .object({
    binanceChainId: z.string().optional(),
    tokenContractAddress: z.string(),
    tokenSymbol: z.string(),
    lastActiveTimestamp: z.string(),
    realizedPnlUsd: numString,
    realizedPnlPercent: numString,
    tokenBalanceUsd: numString,
    tokenBalanceAmount: numString,
    tokenPositionDuration: z
      .object({
        holdingTimestamp: z.string().optional(),
      })
      .nullish(),
    buyTxCount: z.string().optional(),
    buyTxVolume: numString.optional(),
    buyAvgPrice: numString.optional(),
    sellTxCount: z.string().optional(),
    sellTxVolume: numString.optional(),
    sellAvgPrice: numString.optional(),
  })
  .passthrough();

export type RecentPnlItem = z.infer<typeof recentPnlItemSchema>;

export const recentPnlResponseSchema = z
  .object({
    cursor: z.string().nullish(),
    pnlList: z.array(recentPnlItemSchema),
  })
  .passthrough();

export type RecentPnlResponse = z.infer<typeof recentPnlResponseSchema>;

/** 2. Token Latest PnL */
export const tokenLatestPnlSchema = z
  .object({
    realizedPnlUsd: numString,
    realizedPnlPercent: numString,
    buyTxVolume: numString,
    buyAmount: numString,
    buyTxCount: z.string().optional(),
    buyAvgPrice: numString,
    sellTxVolume: numString,
    sellAmount: numString,
    sellTxCount: z.string().optional(),
    sellAvgPrice: numString,
    tokenBalanceAmount: numString,
    tokenBalanceUsd: numString,
    maxBalanceAmount: numString.optional(),
    holdingDuration: z.string().optional(),
    isPnlSupported: z.boolean().optional(),
  })
  .passthrough();

export type TokenLatestPnl = z.infer<typeof tokenLatestPnlSchema>;

/** 3. DEX History */
export const dexHistoryTransactionSchema = z
  .object({
    type: z.string(), // "1" = buy, "2" = sell
    binanceChainId: z.string().optional(),
    chainLogoUrl: z.string().optional(),
    tokenContractAddress: z.string(),
    tokenSymbol: z.string(),
    tokenLogoUrl: z.string().optional(),
    valueUsd: numString,
    amount: numString,
    price: numString,
    marketCap: z.string().nullish(),
    pnlUsd: numString.nullish(),
    txHash: z.string(),
    time: z.string(), // ms timestamp string
  })
  .passthrough();

export type DexHistoryTransaction = z.infer<typeof dexHistoryTransactionSchema>;

export const dexHistoryResponseSchema = z
  .object({
    cursor: z.string().nullish(),
    transactionList: z.array(dexHistoryTransactionSchema),
  })
  .passthrough();

export type DexHistoryResponse = z.infer<typeof dexHistoryResponseSchema>;

/** 4. Portfolio Overview */
export const portfolioOverviewSchema = z
  .object({
    realizedPnlUsd: numString,
    realizedPnlPercent: numString,
    dailyPnl: z
      .array(
        z
          .object({
            date: z.string(),
            pnlUsd: numString,
          })
          .passthrough(),
      )
      .optional(),
    winRate: numString.optional(),
    tokenCountByPnlPercent: z.record(z.string()).optional(),
    buyTxCount: z.string().optional(),
    sellTxCount: z.string().optional(),
    totalTokenCount: z.string().optional(),
    buyTxVolume: numString.optional(),
    sellTxVolume: numString.optional(),
    avgBuyValueUsd: numString.optional(),
    top3PnlTokenSumUsd: numString.optional(),
    top3PnlTokenPercent: numString.optional(),
    topPnlTokenList: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type PortfolioOverview = z.infer<typeof portfolioOverviewSchema>;

/** Helpers to parse responses with validation and optional envelope unwrapping */
export function parseRecentPnl(data: unknown): RecentPnlResponse {
  return recentPnlResponseSchema.parse(unwrapData(data));
}

export function parseTokenLatestPnl(data: unknown): TokenLatestPnl {
  return tokenLatestPnlSchema.parse(unwrapData(data));
}

export function parseDexHistory(data: unknown): DexHistoryResponse {
  return dexHistoryResponseSchema.parse(unwrapData(data));
}

export function parsePortfolioOverview(data: unknown): PortfolioOverview {
  return portfolioOverviewSchema.parse(unwrapData(data));
}

/** Infer ticker and issuer from symbol and contract address */
export function inferTickerAndIssuer(
  symbol: string,
  _address?: string,
): { ticker: string; issuer: Issuer } {
  const s = symbol.trim();
  if (s.endsWith("on")) {
    return { ticker: s.slice(0, -2).toUpperCase(), issuer: "ondo" };
  }
  if (s.endsWith("B")) {
    return { ticker: s.slice(0, -1).toUpperCase(), issuer: "bstock" };
  }
  if (s.endsWith("x")) {
    return { ticker: s.slice(0, -1).toUpperCase(), issuer: "xstocks" };
  }
  return { ticker: s.toUpperCase(), issuer: "ondo" };
}

/** Map recent PnL list items to Holding domain objects */
export function recentPnlToHoldings(
  items: RecentPnlItem[],
  multiplierMap: Record<string, bigint> = {},
): Holding[] {
  return items.map((item) => {
    const { ticker, issuer } = inferTickerAndIssuer(item.tokenSymbol, item.tokenContractAddress);
    const balanceTokens = parseDecimal(item.tokenBalanceAmount, 18);
    const observedMultiplier =
      multiplierMap[item.tokenContractAddress.toLowerCase()] ??
      multiplierMap[item.tokenSymbol.toLowerCase()] ??
      null;

    const multiplier = observedMultiplier ?? E18;
    const convertedAtTodaysRatio = observedMultiplier === null;
    const balanceShares = mulDiv(balanceTokens, multiplier, E18);

    const tokenBalanceUsd = Number(item.tokenBalanceUsd);
    const buyVolumeUsd = item.buyTxVolume ? Number(item.buyTxVolume) : 0;
    const sellVolumeUsd = item.sellTxVolume ? Number(item.sellTxVolume) : 0;
    const costBasisUsd = Math.max(0, buyVolumeUsd - sellVolumeUsd);

    const balanceSharesNum = Number(formatUnits(balanceShares, 18));
    const pricePerShareUsd = balanceSharesNum > 0 ? tokenBalanceUsd / balanceSharesNum : 0;
    const avgCostPerShareUsd = balanceSharesNum > 0 ? costBasisUsd / balanceSharesNum : 0;
    const unrealizedPnlUsd = tokenBalanceUsd - costBasisUsd;
    const unrealizedPnlPercent = costBasisUsd > 0 ? (unrealizedPnlUsd / costBasisUsd) * 100 : 0;

    return {
      tokenContractAddress: item.tokenContractAddress.toLowerCase(),
      tokenSymbol: item.tokenSymbol,
      ticker,
      issuer,
      balanceTokens,
      multiplier,
      balanceShares,
      convertedAtTodaysRatio,
      tokenBalanceUsd,
      pricePerShareUsd,
      costBasisUsd,
      avgCostPerShareUsd,
      unrealizedPnlUsd,
      unrealizedPnlPercent,
      source: "api/portfolio/recent-pnl",
    };
  });
}

/** Map DEX history transactions to Trade domain objects */
export function dexHistoryToTrades(
  transactions: DexHistoryTransaction[],
  multiplierMap: Record<string, bigint> = {},
): Trade[] {
  return transactions.map((tx) => {
    const { ticker, issuer } = inferTickerAndIssuer(tx.tokenSymbol, tx.tokenContractAddress);
    const amountTokens = parseDecimal(tx.amount, 18);
    const observedMultiplier =
      multiplierMap[tx.tokenContractAddress.toLowerCase()] ??
      multiplierMap[tx.tokenSymbol.toLowerCase()] ??
      null;

    const multiplier = observedMultiplier ?? E18;
    const convertedAtTodaysRatio = observedMultiplier === null;
    const amountShares = mulDiv(amountTokens, multiplier, E18);

    const pricePerTokenUsd = Number(tx.price);
    const multNum = Number(formatUnits(multiplier, 18));
    const pricePerShareUsd = multNum > 0 ? pricePerTokenUsd / multNum : pricePerTokenUsd;
    const valueUsd = Number(tx.valueUsd);
    const realizedPnlUsd =
      tx.pnlUsd !== null && tx.pnlUsd !== undefined ? Number(tx.pnlUsd) : undefined;

    return {
      txHash: tx.txHash,
      time: Number(tx.time),
      type: tx.type === "1" ? "BUY" : "SELL",
      tokenContractAddress: tx.tokenContractAddress.toLowerCase(),
      tokenSymbol: tx.tokenSymbol,
      ticker,
      issuer,
      amountTokens,
      multiplier,
      amountShares,
      convertedAtTodaysRatio,
      pricePerTokenUsd,
      pricePerShareUsd,
      valueUsd,
      realizedPnlUsd,
    };
  });
}

/** Map recent PnL list items to PnlLine domain objects */
export function recentPnlToPnlLines(items: RecentPnlItem[]): PnlLine[] {
  return items.map((item) => {
    const { ticker, issuer } = inferTickerAndIssuer(item.tokenSymbol, item.tokenContractAddress);
    return {
      tokenContractAddress: item.tokenContractAddress.toLowerCase(),
      tokenSymbol: item.tokenSymbol,
      ticker,
      issuer,
      realizedPnlUsd: Number(item.realizedPnlUsd),
      realizedPnlPercent: Number(item.realizedPnlPercent),
      buyVolumeUsd: item.buyTxVolume ? Number(item.buyTxVolume) : 0,
      sellVolumeUsd: item.sellTxVolume ? Number(item.sellTxVolume) : 0,
      buyTxCount: item.buyTxCount ? Number(item.buyTxCount) : 0,
      sellTxCount: item.sellTxCount ? Number(item.sellTxCount) : 0,
      lastActiveTimestamp: Number(item.lastActiveTimestamp),
    };
  });
}
