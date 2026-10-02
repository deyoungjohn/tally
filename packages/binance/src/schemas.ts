import { z } from "zod";

/** Numbers arrive as strings. Schemas are deliberately loose about extra fields (the API adds some) and strict about the ones we use. */
const num = z.string().regex(/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/, "not a number string");

export const tokenRef = z
  .object({
    tokenContractAddress: z.string(),
    tokenSymbol: z.string(),
    tokenUnitPrice: num.nullish(),
    decimal: z.string(),
  })
  .passthrough();

export const dexHop = z
  .object({
    dexProtocol: z.object({ dexName: z.string(), percent: z.string().optional() }).passthrough(),
    fromToken: tokenRef,
    toToken: tokenRef,
    fromTokenIndex: z.string(),
    toTokenIndex: z.string(),
  })
  .passthrough();

export const quoteItem = z
  .object({
    quoteId: z.string(),
    vendorName: z.string(),
    executionMode: z.string(),
    binanceChainId: z.string(),
    fromTokenAmount: z.string().regex(/^\d+$/),
    toTokenAmount: z.string().regex(/^\d+$/),
    tradeFee: num.nullish(),
    estimateGasFee: z.string(),
    priceImpactPercent: num.nullish(),
    router: z.string().optional(),
    fromToken: tokenRef,
    toToken: tokenRef,
    dexRouterList: z.array(dexHop),
    approveTarget: z.string(),
    isBest: z.boolean().optional(),
  })
  .passthrough();
export type QuoteItem = z.infer<typeof quoteItem>;
export const quoteResponse = z.array(quoteItem);

export const swapTx = z
  .object({
    from: z.string(),
    to: z.string(),
    data: z.string(),
    value: z.string(),
    gas: z.string(),
    gasPrice: z.string().nullish(),
    minReceiveAmount: z.string().nullish(),
    slippagePercent: z.string().nullish(),
  })
  .passthrough();

export const swapResponse = z
  .object({
    executionMode: z.string(),
    routerResult: quoteItem
      .partial({
        quoteId: true,
        isBest: true,
        approveTarget: true,
        binanceChainId: true,
        executionMode: true,
      })
      .passthrough(),
    tx: swapTx.nullable(),
    rfq: z.unknown().nullish(),
  })
  .passthrough();
export type SwapResponse = z.infer<typeof swapResponse>;

export const supportedChains = z.array(
  z
    .object({ binanceChainId: z.string(), name: z.string(), shortName: z.string().optional() })
    .passthrough(),
);

export const statusInfo = z
  .object({
    openState: z.boolean().nullish(),
    marketStatus: z.string().nullish(),
    reasonCode: z.string().nullish(),
    reasonMsg: z.string().nullish(),
    nextOpenTime: z.number().nullish(),
    nextCloseTime: z.number().nullish(),
  })
  .passthrough();

/** Authenticated RWA Data API: /api/v1/dex/market/rwa/tokens. */
export const rwaToken = z
  .object({
    binanceChainId: z.string(),
    tokenContractAddress: z.string(),
    platformId: z.string(),
    assetType: z.number().nullish(),
    tokenSymbol: z.string(),
    decimals: z.string(),
    underlyingTicker: z.string(),
    tokenToShareRatio: num.nullish(),
    statusInfo: statusInfo.nullish(),
    tokenPrice: num.nullish(),
    referencePrice: num.nullish(),
    volume24H: num.nullish(),
  })
  .passthrough();
export type RwaToken = z.infer<typeof rwaToken>;
export const rwaTokensResponse = z.array(rwaToken);

/** /market/rwa/underlying-profile: `protections` holds attestation reports (Ondo: dailyAttestationReport.url with the date in the filename; bStock: collateralReport with a null url). */
export const underlyingProfile = z
  .object({
    tokenContractAddress: z.string(),
    platformId: z.string(),
    underlyingTicker: z.string(),
    tokenToShareRatio: num.nullish(),
    protections: z
      .record(
        z.object({ supported: z.boolean().nullish(), url: z.string().nullish() }).passthrough(),
      )
      .nullish(),
  })
  .passthrough();

/** /market/rwa/underlying-market: `referencePrice` here is per SHARE; `dividendYield` is a percent ("0.12" = 0.12%). */
export const underlyingMarket = z
  .object({
    tokenContractAddress: z.string(),
    statusInfo: statusInfo.nullish(),
    marketData: z
      .object({
        referencePrice: num.nullish(),
        dividendYield: num.nullish(),
        latestDividend: num.nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

/** POST /pre-transaction/simulate. Verified 2026-10-02 with body { binanceChainId, evmTx: { from, to, data, value } }. */
export const simulateResponse = z
  .object({
    status: z.string(),
    failReason: z.string().nullish(),
    balanceChanges: z.array(z.unknown()).nullish(),
    allowanceChanges: z.array(z.unknown()).nullish(),
  })
  .passthrough();

export const gasPriceResponse = z
  .object({
    evmLegacyGasPrice: z
      .object({ lowGasPrice: z.string(), mediumGasPrice: z.string(), highGasPrice: z.string() })
      .nullish(),
    eip1559GasPrice: z.unknown().nullish(),
  })
  .passthrough();

export const rwaSearchResponse = z.array(
  z
    .object({
      ticker: z.string(),
      companyName: z.string().nullish(),
      assets: z.array(
        z
          .object({
            platformId: z.string(),
            binanceChainId: z.string(),
            tokenContractAddress: z.string(),
            tokenSymbol: z.string(),
            assetType: z.number().optional(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
);

export const rwaPlatformsResponse = z.array(
  z.object({ platformId: z.string(), tickerCount: z.number() }).passthrough(),
);

/** Public, key-less endpoints (cross-check only, blueprint V15). Envelope: { code: "000000", data }. */
export const publicEnvelope = z
  .object({ code: z.union([z.string(), z.number()]), data: z.unknown() })
  .passthrough();

export const publicListRow = z
  .object({
    chainId: z.string(),
    contractAddress: z.string(),
    symbol: z.string(),
    ticker: z.string(),
    type: z.number(),
    assetType: z.number().nullish(),
    multiplier: num.nullish(),
    lastUpdateTime: z.number().nullish(),
    d: z.number(),
  })
  .passthrough();
export type PublicListRow = z.infer<typeof publicListRow>;

/** v4 token dynamic: on-chain volume lives in volume24hBuy + volume24hSell (research/analyze_snapshot.py). */
export const tokenDynamic = z
  .object({ price: num.nullish(), volume24hBuy: num.nullish(), volume24hSell: num.nullish() })
  .passthrough();

/** v2 RWA dynamic: sharesMultiplier, US stock price, dividend yield (percent), status (Ondo only). */
export const rwaDynamic = z
  .object({
    tokenInfo: z
      .object({ price: num.nullish(), sharesMultiplier: num.nullish() })
      .passthrough()
      .nullish(),
    stockInfo: z
      .object({ price: num.nullish(), dividendYield: num.nullish() })
      .passthrough()
      .nullish(),
    statusInfo: statusInfo.nullish(),
  })
  .passthrough();
