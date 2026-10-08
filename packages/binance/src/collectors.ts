import { z } from "zod";
import { BinanceClient } from "./client";
import { rwaTokensResponse } from "./schemas";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const decimal = z.string().regex(/^\d+(\.\d+)?([eE][-+]?\d+)?$/);
const signedDecimal = z.string().regex(/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/, "not a number string");

export const rwaPrice = z
  .object({
    binanceChainId: z.literal("56"),
    tokenContractAddress: address,
    platformId: z.string(),
    tokenPrice: decimal,
    referencePrice: decimal.nullish(),
    tokenPriceUpdatedAt: z.number().int().nonnegative(),
  })
  .passthrough();
export const rwaPricesResponse = z.array(rwaPrice);
export type RwaPrice = z.infer<typeof rwaPrice>;

export const marketTrade = z
  .object({
    binanceChainId: z.literal("56"),
    tokenContractAddress: address,
    txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    userAddress: address,
    type: z.enum(["buy", "sell"]),
    time: z.number().int().nonnegative(),
    changedTokenInfo: z.array(
      z.object({ tokenContractAddress: address, amount: signedDecimal, tokenSymbol: z.string() }),
    ),
  })
  .passthrough();
export const tradesPage = z.object({ cursor: z.string().nullish(), trades: z.array(marketTrade) });
export const marketHolder = z
  .object({
    holderWalletAddress: address,
    holdAmount: decimal,
    holdingPercent: decimal.nullable(),
    boughtAmount: decimal,
    soldAmount: decimal,
    avgBuyPrice: decimal.nullish(),
    avgSellPrice: decimal.nullish(),
    fundingSourceLabel: z.object({ tagName: z.string(), tagValue: z.string().nullish() }).nullish(),
  })
  .passthrough();
export const marketLiquidity = z
  .object({
    // V4 returns a bytes32 pool ID, which is NOT a Transfer endpoint address.
    poolAddress: z.string().regex(/^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/),
    pool: z.string(),
    liquidityAmount: z.array(
      z.object({ tokenContractAddress: address, tokenSymbol: z.string() }).passthrough(),
    ),
  })
  .passthrough();
export type MarketTrade = z.infer<typeof marketTrade>;
export type TradesPage = z.infer<typeof tradesPage>;
export type MarketHolder = z.infer<typeof marketHolder>;
export type MarketLiquidity = z.infer<typeof marketLiquidity>;

export const recentPnlItem = z
  .object({
    binanceChainId: z.string().optional(),
    tokenContractAddress: address,
    tokenSymbol: z.string(),
    lastActiveTimestamp: z.string(),
    realizedPnlUsd: signedDecimal,
    realizedPnlPercent: signedDecimal,
    tokenBalanceUsd: signedDecimal,
    tokenBalanceAmount: signedDecimal,
    tokenPositionDuration: z
      .object({
        holdingTimestamp: z.string().optional(),
      })
      .nullish(),
    buyTxCount: z.string().optional(),
    buyTxVolume: signedDecimal.optional(),
    buyAvgPrice: signedDecimal.optional(),
    sellTxCount: z.string().optional(),
    sellTxVolume: signedDecimal.optional(),
    sellAvgPrice: signedDecimal.optional(),
  })
  .passthrough();
export type RecentPnlItem = z.infer<typeof recentPnlItem>;

export const recentPnlResponse = z
  .object({
    cursor: z.string().nullish(),
    pnlList: z.array(recentPnlItem),
  })
  .passthrough();
export type RecentPnlResponse = z.infer<typeof recentPnlResponse>;

export const dexHistoryTransaction = z
  .object({
    type: z.string(), // "1" = buy, "2" = sell
    binanceChainId: z.string().optional(),
    chainLogoUrl: z.string().optional(),
    tokenContractAddress: address,
    tokenSymbol: z.string(),
    tokenLogoUrl: z.string().optional(),
    valueUsd: signedDecimal,
    amount: signedDecimal,
    price: signedDecimal,
    marketCap: z.string().nullish(),
    pnlUsd: signedDecimal.nullish(),
    txHash: z.string(),
    time: z.string(),
  })
  .passthrough();
export type DexHistoryTransaction = z.infer<typeof dexHistoryTransaction>;

export const dexHistoryResponse = z
  .object({
    cursor: z.string().nullish(),
    transactionList: z.array(dexHistoryTransaction),
  })
  .passthrough();
export type DexHistoryResponse = z.infer<typeof dexHistoryResponse>;

export const portfolioOverviewResponse = z
  .object({
    realizedPnlUsd: signedDecimal,
    realizedPnlPercent: signedDecimal,
    dailyPnl: z
      .array(
        z
          .object({
            date: z.string(),
            pnlUsd: signedDecimal,
          })
          .passthrough(),
      )
      .optional(),
    winRate: signedDecimal.optional(),
    tokenCountByPnlPercent: z.record(z.string()).optional(),
    buyTxCount: z.string().optional(),
    sellTxCount: z.string().optional(),
    totalTokenCount: z.string().optional(),
    buyTxVolume: signedDecimal.optional(),
    sellTxVolume: signedDecimal.optional(),
    avgBuyValueUsd: signedDecimal.optional(),
    top3PnlTokenSumUsd: signedDecimal.optional(),
    top3PnlTokenPercent: signedDecimal.optional(),
    topPnlTokenList: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type PortfolioOverviewResponse = z.infer<typeof portfolioOverviewResponse>;

export const tokenLatestPnlResponse = z
  .object({
    realizedPnlUsd: signedDecimal,
    realizedPnlPercent: signedDecimal,
    buyTxVolume: signedDecimal,
    buyAmount: signedDecimal,
    buyTxCount: z.string().optional(),
    buyAvgPrice: signedDecimal,
    sellTxVolume: signedDecimal,
    sellAmount: signedDecimal,
    sellTxCount: z.string().optional(),
    sellAvgPrice: signedDecimal,
    tokenBalanceAmount: signedDecimal,
    tokenBalanceUsd: signedDecimal,
    maxBalanceAmount: signedDecimal.optional(),
    holdingDuration: z.string().optional(),
    isPnlSupported: z.boolean().optional(),
  })
  .passthrough();
export type TokenLatestPnlResponse = z.infer<typeof tokenLatestPnlResponse>;

/** Additive scheduled-data interface. Reuses the signed client's pacing, retries and error mapping. */
export class BinanceCollectors {
  constructor(private readonly client: BinanceClient) {}
  trades(token: string, cursor?: string, limit = 100): Promise<TradesPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new RangeError("trades limit must be 1..100");
    return this.client.get(
      "/api/v1/dex/market/trades",
      {
        binanceChainId: "56",
        tokenContractAddress: address.parse(token),
        cursor,
        limit,
      },
      tradesPage,
    );
  }
  holders(token: string): Promise<MarketHolder[]> {
    return this.client.get(
      "/api/v1/dex/market/token/holder",
      {
        binanceChainId: "56",
        tokenContractAddress: address.parse(token),
      },
      z.array(marketHolder),
    );
  }
  topTraders(token: string): Promise<MarketHolder[]> {
    return this.client.get(
      "/api/v1/dex/market/token/top-trader",
      {
        binanceChainId: "56",
        tokenContractAddress: address.parse(token),
      },
      z.array(marketHolder),
    );
  }
  topLiquidity(token: string): Promise<MarketLiquidity[]> {
    return this.client.get(
      "/api/v1/dex/market/token/top-liquidity",
      {
        binanceChainId: "56",
        tokenContractAddress: address.parse(token),
      },
      z.array(marketLiquidity),
    );
  }
  registry(platformId?: "ondo" | "bstock") {
    return this.client.get(
      "/api/v1/dex/market/rwa/tokens",
      { binanceChainId: "56", platformId },
      rwaTokensResponse,
    );
  }
  prices(addresses: readonly string[]): Promise<RwaPrice[]> {
    if (addresses.length === 0) return Promise.resolve([]);
    if (addresses.length > 20) throw new RangeError("rwa/price accepts at most 20 addresses");
    const validated = addresses.map((a) => address.parse(a));
    return this.client.get(
      "/api/v1/dex/market/rwa/price",
      {
        binanceChainId: "56",
        tokenContractAddresses: validated.join(","),
      },
      rwaPricesResponse,
    );
  }
  recentPnl(walletAddress: string): Promise<RecentPnlResponse> {
    const validated = address.parse(walletAddress);
    return this.client.get(
      "/api/v1/dex/market/portfolio/recent-pnl",
      { binanceChainId: "56", walletAddress: validated },
      recentPnlResponse,
    );
  }
  dexHistory(walletAddress: string): Promise<DexHistoryResponse> {
    const validated = address.parse(walletAddress);
    return this.client.get(
      "/api/v1/dex/market/portfolio/dex-history",
      { binanceChainId: "56", walletAddress: validated },
      dexHistoryResponse,
    );
  }
  portfolioOverview(walletAddress: string, timeFrame = "1"): Promise<PortfolioOverviewResponse> {
    const validated = address.parse(walletAddress);
    return this.client.get(
      "/api/v1/dex/market/portfolio/overview",
      { binanceChainId: "56", walletAddress: validated, timeFrame },
      portfolioOverviewResponse,
    );
  }
  tokenLatestPnl(
    walletAddress: string,
    tokenContractAddress: string,
  ): Promise<TokenLatestPnlResponse> {
    const validatedWallet = address.parse(walletAddress);
    const validatedToken = address.parse(tokenContractAddress);
    return this.client.get(
      "/api/v1/dex/market/portfolio/token/latest-pnl",
      {
        binanceChainId: "56",
        walletAddress: validatedWallet,
        tokenContractAddress: validatedToken,
      },
      tokenLatestPnlResponse,
    );
  }
}
