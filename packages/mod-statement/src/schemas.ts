import { z } from "zod";
import { parseDecimal, E18, mulDiv, formatUnits } from "@tally/core";
import type {
  Holding,
  Trade,
  PnlLine,
  TokenRegistryInfo,
  TokenRegistryLookup,
  MultiplierMap,
} from "./types";

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
    buyAmount: numString.optional(),
    sellAmount: numString.optional(),
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

function resolveRegistryToken(
  address: string,
  registry: Record<string, TokenRegistryInfo> | TokenRegistryLookup,
): TokenRegistryInfo | undefined {
  if (typeof registry === "function") {
    return registry(address);
  }
  return registry[address.toLowerCase()];
}

/** Map recent PnL list items to Holding domain objects using registry lookup */
export function recentPnlToHoldings(
  items: RecentPnlItem[],
  registry: Record<string, TokenRegistryInfo> | TokenRegistryLookup,
  multiplierMap: MultiplierMap = {},
): Holding[] {
  return items.map((item) => {
    const addr = item.tokenContractAddress.toLowerCase();
    const regToken = resolveRegistryToken(addr, registry);

    const isRecognized = regToken !== undefined && regToken.issuer !== null;
    const ticker = regToken ? regToken.ticker : item.tokenSymbol;
    const issuer = regToken ? regToken.issuer : null;
    const unrecognizedReason = isRecognized ? undefined : "Not a recognised tokenized stock";

    const balanceTokens = parseDecimal(item.tokenBalanceAmount, 18);

    let multiplier: bigint | null = null;
    let convertedAtTodaysRatio = false;

    if (isRecognized) {
      const multEntry = multiplierMap[addr];
      if (multEntry !== undefined) {
        if (typeof multEntry === "bigint") {
          multiplier = multEntry;
          convertedAtTodaysRatio = false;
        } else {
          multiplier = multEntry.multiplier;
          convertedAtTodaysRatio = multEntry.isTodaysRatio ?? false;
        }
      } else if (regToken.tokenToShareRatio !== undefined && regToken.tokenToShareRatio > 0n) {
        multiplier = regToken.tokenToShareRatio;
        convertedAtTodaysRatio = true;
      }
    }

    const balanceShares = multiplier !== null ? mulDiv(balanceTokens, multiplier, E18) : null;
    const sharesUnavailableReason =
      balanceShares === null
        ? isRecognized
          ? "Multiplier unavailable from observation or registry today ratio"
          : "Not a recognised tokenized stock"
        : undefined;

    const tokenBalanceUsdE18 = parseDecimal(item.tokenBalanceUsd, 18);
    const buyVolumeUsdE18 = item.buyTxVolume ? parseDecimal(item.buyTxVolume, 18) : 0n;
    const sellVolumeUsdE18 = item.sellTxVolume ? parseDecimal(item.sellTxVolume, 18) : 0n;
    // Average-cost method on tokens: what is still held carries its share of the buy volume. (The old "buy volume minus sell
    // volume" mixed what was paid with what was received on sale, so a gain on a sold part wiped out the cost of the part still held.)
    let costBasisUsdE18: bigint;
    let costKnown = true;
    let boughtTokens = item.buyAmount ? parseDecimal(item.buyAmount, 18) : 0n;
    if (boughtTokens === 0n && item.buyAvgPrice && buyVolumeUsdE18 > 0n) {
      const avg = parseDecimal(item.buyAvgPrice, 18);
      boughtTokens = avg > 0n ? mulDiv(buyVolumeUsdE18, E18, avg) : 0n;
    }
    if (boughtTokens > 0n) {
      const soldTokens = item.sellAmount ? parseDecimal(item.sellAmount, 18) : 0n;
      const open = boughtTokens > soldTokens ? boughtTokens - soldTokens : 0n;
      const matched = balanceTokens < open ? balanceTokens : open;
      costBasisUsdE18 = mulDiv(buyVolumeUsdE18, matched, boughtTokens);
      // More tokens held than purchases explain (received from another wallet): no honest cost for the whole position.
      if (balanceTokens > 0n && mulDiv(balanceTokens, 100n, 1n) > mulDiv(open, 102n, 1n))
        costKnown = false;
    } else {
      costBasisUsdE18 =
        buyVolumeUsdE18 > sellVolumeUsdE18 ? buyVolumeUsdE18 - sellVolumeUsdE18 : 0n;
      if (balanceTokens > 0n && buyVolumeUsdE18 === 0n) costKnown = false;
    }

    const avgCostPerShareUsdE18 =
      balanceShares !== null && balanceShares > 0n
        ? mulDiv(costBasisUsdE18, E18, balanceShares)
        : null;
    const pricePerShareUsdE18 =
      balanceShares !== null && balanceShares > 0n
        ? mulDiv(tokenBalanceUsdE18, E18, balanceShares)
        : null;
    const unrealizedPnlUsdE18 = tokenBalanceUsdE18 - costBasisUsdE18;

    return {
      tokenContractAddress: addr,
      tokenSymbol: item.tokenSymbol,
      ticker,
      issuer,
      isRecognized,
      unrecognizedReason,
      balanceTokens,
      multiplier,
      balanceShares,
      sharesUnavailableReason,
      convertedAtTodaysRatio,
      tokenBalanceUsdE18,
      costBasisUsdE18,
      avgCostPerShareUsdE18,
      pricePerShareUsdE18,
      unrealizedPnlUsdE18,
      costKnown,
      source: "api/portfolio/recent-pnl",
      rowActionsSlot: {
        token: addr,
        issuer,
        balanceTokens: formatUnits(balanceTokens, 18, 4),
        balanceShares: balanceShares !== null ? formatUnits(balanceShares, 18, 4) : null,
        ticker,
      },
    };
  });
}

/** Map DEX history transactions to Trade domain objects using registry lookup */
export function dexHistoryToTrades(
  transactions: DexHistoryTransaction[],
  registry: Record<string, TokenRegistryInfo> | TokenRegistryLookup,
  multiplierMap: MultiplierMap = {},
): Trade[] {
  return transactions.map((tx) => {
    const addr = tx.tokenContractAddress.toLowerCase();
    const regToken = resolveRegistryToken(addr, registry);

    const isRecognized = regToken !== undefined && regToken.issuer !== null;
    const ticker = regToken ? regToken.ticker : tx.tokenSymbol;
    const issuer = regToken ? regToken.issuer : null;
    const unrecognizedReason = isRecognized ? undefined : "Not a recognised tokenized stock";

    const amountTokens = parseDecimal(tx.amount, 18);

    let multiplier: bigint | null = null;
    let convertedAtTodaysRatio = false;

    if (isRecognized) {
      const multEntry = multiplierMap[addr];
      if (multEntry !== undefined) {
        if (typeof multEntry === "bigint") {
          multiplier = multEntry;
          convertedAtTodaysRatio = false;
        } else {
          multiplier = multEntry.multiplier;
          convertedAtTodaysRatio = multEntry.isTodaysRatio ?? false;
        }
      } else if (regToken.tokenToShareRatio !== undefined && regToken.tokenToShareRatio > 0n) {
        multiplier = regToken.tokenToShareRatio;
        convertedAtTodaysRatio = true;
      }
    }

    const amountShares = multiplier !== null ? mulDiv(amountTokens, multiplier, E18) : null;
    const sharesUnavailableReason =
      amountShares === null
        ? isRecognized
          ? "Multiplier unavailable from observation or registry today ratio"
          : "Not a recognised tokenized stock"
        : undefined;

    const valueUsdE18 = parseDecimal(tx.valueUsd, 18);
    const pricePerTokenUsdE18 = parseDecimal(tx.price, 18);
    const pricePerShareUsdE18 =
      amountShares !== null && amountShares > 0n ? mulDiv(valueUsdE18, E18, amountShares) : null;
    const realizedPnlUsdE18 =
      tx.pnlUsd !== null && tx.pnlUsd !== undefined ? parseDecimal(tx.pnlUsd, 18) : undefined;

    return {
      txHash: tx.txHash,
      time: Number(tx.time),
      type: tx.type === "1" ? "BUY" : "SELL",
      tokenContractAddress: addr,
      tokenSymbol: tx.tokenSymbol,
      ticker,
      issuer,
      isRecognized,
      unrecognizedReason,
      amountTokens,
      multiplier,
      amountShares,
      sharesUnavailableReason,
      convertedAtTodaysRatio,
      pricePerTokenUsdE18,
      pricePerShareUsdE18,
      valueUsdE18,
      realizedPnlUsdE18,
    };
  });
}

/** Map recent PnL list items to PnlLine domain objects using registry lookup */
export function recentPnlToPnlLines(
  items: RecentPnlItem[],
  registry: Record<string, TokenRegistryInfo> | TokenRegistryLookup,
): PnlLine[] {
  return items.map((item) => {
    const addr = item.tokenContractAddress.toLowerCase();
    const regToken = resolveRegistryToken(addr, registry);
    const isRecognized = regToken !== undefined && regToken.issuer !== null;
    const ticker = regToken ? regToken.ticker : item.tokenSymbol;
    const issuer = regToken ? regToken.issuer : null;

    const buyVolumeUsdE18 = item.buyTxVolume ? parseDecimal(item.buyTxVolume, 18) : 0n;
    const sellVolumeUsdE18 = item.sellTxVolume ? parseDecimal(item.sellTxVolume, 18) : 0n;
    const realizedPnlUsdE18 = parseDecimal(item.realizedPnlUsd, 18);

    return {
      tokenContractAddress: addr,
      tokenSymbol: item.tokenSymbol,
      ticker,
      issuer,
      isRecognized,
      realizedPnlUsdE18,
      buyVolumeUsdE18,
      sellVolumeUsdE18,
      buyTxCount: item.buyTxCount ? Number(item.buyTxCount) : 0,
      sellTxCount: item.sellTxCount ? Number(item.sellTxCount) : 0,
      lastActiveTimestamp: Number(item.lastActiveTimestamp),
    };
  });
}
