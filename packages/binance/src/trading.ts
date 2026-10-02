import { BNB_NATIVE, BSC_CHAIN_ID, USDT_BSC } from "@tally/config";
import type { Address, RawQuote } from "@tally/core";
import { BinanceClient } from "./client";
import {
  gasPriceResponse,
  quoteResponse,
  rwaPlatformsResponse,
  rwaSearchResponse,
  rwaTokensResponse,
  simulateResponse,
  supportedChains,
  swapResponse,
  underlyingMarket,
  underlyingProfile,
  type QuoteItem,
} from "./schemas";

const CHAIN = String(BSC_CHAIN_ID);
const P = {
  quote: "/api/v1/dex/aggregator/quote",
  swap: "/api/v1/dex/aggregator/swap",
  supported: "/api/v1/dex/aggregator/supported/chain",
  rwaTokens: "/api/v1/dex/market/rwa/tokens",
  rwaSearch: "/api/v1/dex/market/rwa/search",
  rwaPlatforms: "/api/v1/dex/market/rwa/platforms",
  underlyingProfile: "/api/v1/dex/market/rwa/underlying-profile",
  underlyingMarket: "/api/v1/dex/market/rwa/underlying-market",
  simulate: "/api/v1/dex/pre-transaction/simulate",
  gasPrice: "/api/v1/dex/pre-transaction/gas-price",
} as const;

export interface QuoteParams {
  toToken: string;
  /** Amount of `fromToken` in its own decimals. */
  amount: bigint;
  /** Required for Ondo (40001 without it). Always send one (V8). */
  wallet: string;
  fromToken?: string;
}

export interface SwapParams extends QuoteParams {
  quoteId: string;
  /** Percent, e.g. "1" for 1%. */
  slippagePercent: string;
}

/** Typed endpoints. Verified against fixtures/raw (recorded on the Seoul EC2, 2026-10-02). */
export class BinanceApi {
  constructor(private readonly client: BinanceClient) {}

  /** Health check; also the call that reveals a region block (40304) for a caller IP. */
  supportedChains() {
    return this.client.get(P.supported, { binanceChainId: CHAIN }, supportedChains);
  }

  /** All routes the API returns (in practice one, V7). */
  quoteRoutes(p: QuoteParams): Promise<QuoteItem[]> {
    return this.client.get(
      P.quote,
      {
        binanceChainId: CHAIN,
        amount: p.amount.toString(),
        fromTokenAddress: p.fromToken ?? USDT_BSC,
        toTokenAddress: p.toToken,
        userWalletAddress: p.wallet,
      },
      quoteResponse,
    );
  }

  swap(p: SwapParams) {
    return this.client.get(
      P.swap,
      {
        binanceChainId: CHAIN,
        amount: p.amount.toString(),
        fromTokenAddress: p.fromToken ?? USDT_BSC,
        toTokenAddress: p.toToken,
        userWalletAddress: p.wallet,
        quoteId: p.quoteId,
        slippagePercent: p.slippagePercent,
      },
      swapResponse,
    );
  }

  /** Authenticated RWA list. As recorded it returns 488 of 545 BSC tokens (Ondo and bStock only, no xStocks): not a complete registry. */
  rwaTokens() {
    return this.client.get(P.rwaTokens, { chainId: CHAIN }, rwaTokensResponse);
  }

  rwaSearch(keyword: string) {
    return this.client.get(P.rwaSearch, { keyword }, rwaSearchResponse);
  }

  rwaPlatforms() {
    return this.client.get(P.rwaPlatforms, {}, rwaPlatformsResponse);
  }

  underlyingProfile(tokenContractAddress: string) {
    return this.client.get(
      P.underlyingProfile,
      { binanceChainId: CHAIN, tokenContractAddress },
      underlyingProfile,
    );
  }

  underlyingMarket(tokenContractAddress: string) {
    return this.client.get(
      P.underlyingMarket,
      { binanceChainId: CHAIN, tokenContractAddress },
      underlyingMarket,
    );
  }

  /** Binance Transaction API simulation, used alongside eth_call before showing "Buy" (blueprint §7.6 step 6). */
  simulate(tx: { from: string; to: string; data: string; value?: string }) {
    return this.client.post(
      P.simulate,
      { binanceChainId: CHAIN, evmTx: { value: "0", ...tx } },
      simulateResponse,
    );
  }

  /** Binance's gas price tiers in wei. We estimate gas ourselves (V10); this is only a cross-check for the price. */
  gasPrice() {
    return this.client.get(P.gasPrice, { binanceChainId: CHAIN }, gasPriceResponse);
  }

  /** BNB price in USD, read from the `tokenUnitPrice` of a small BNB quote (blueprint §7.4 step 7). */
  async bnbUsd(wallet: string): Promise<number> {
    const [r] = await this.quoteRoutes({ toToken: BNB_NATIVE, amount: 6n * 10n ** 18n, wallet });
    const price = Number(r?.toToken.tokenUnitPrice);
    if (!r || !Number.isFinite(price) || price <= 0) throw new Error("no BNB price in the quote");
    return price;
  }
}

/** Normalise the API's quote for core: distinct sequential legs (parallel splits count once), amounts as bigint. */
export function toRawQuote(item: QuoteItem): RawQuote {
  const legs = new Map<number, string>();
  const dexByLeg = new Map<number, string>();
  for (const h of item.dexRouterList) {
    const idx = Number(h.toTokenIndex);
    legs.set(idx, h.toToken.tokenSymbol);
    if (!dexByLeg.has(idx)) dexByLeg.set(idx, h.dexProtocol.dexName);
  }
  const ordered = [...legs.keys()].sort((a, b) => a - b);
  return {
    quoteId: item.quoteId,
    vendor: item.vendorName,
    executionMode: item.executionMode,
    amountIn: BigInt(item.fromTokenAmount),
    tokensOut: BigInt(item.toTokenAmount),
    usdtPrice: Number(item.fromToken.tokenUnitPrice ?? "1"),
    priceImpactPct: Number(item.priceImpactPercent ?? "0"),
    apiGas: Number(item.estimateGasFee),
    hops: ordered.map((i) => ({ dex: dexByLeg.get(i)!, toSymbol: legs.get(i)! })),
    legCount: ordered.length || 1,
    approveTarget: item.approveTarget.toLowerCase() as Address,
  };
}

export function pickBest(routes: QuoteItem[]): QuoteItem | undefined {
  return routes.find((r) => r.isBest) ?? routes[0];
}
