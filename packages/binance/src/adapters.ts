import { TTL_MS } from "@tally/config";
import {
  Registry,
  TtlCache,
  isKindedError,
  parseDecimal,
  sessionFromMarketStatus,
  statusFromInfo,
  type Address,
  type EnginePorts,
  type Issuer,
  type MultiplierReadings,
  type RawQuote,
  type ReferencePrice,
  type RegistryRow,
  type RegistryToken,
  type Session,
  type TokenMarketFacts,
} from "@tally/core";
import { BinanceApi, pickBest, toRawQuote } from "./trading";
import { PublicApi } from "./public";
import { BinanceApiError } from "./errors";
import type { RwaToken } from "./schemas";

const ISSUER_BY_TYPE: Record<number, Issuer> = { 1: "ondo", 2: "xstocks", 3: "bstock" };
const FATAL = new Set(["region_block", "auth"]);

export type OnchainMultiplierReader = (token: RegistryToken) => Promise<bigint | undefined>;

export interface BinanceDataOptions {
  api: BinanceApi;
  pub: PublicApi;
  /** bStock `uiMultiplier()` and xStocks `multiplier()` reads, from @tally/chain. Omit to run without on-chain readings. */
  onchain?: OnchainMultiplierReader;
  now?: () => number;
  /** Called whenever a data source fails and a weaker fallback is used. Silent degradation hid a schema bug once (2026-10-02). */
  onWarn?: (message: string) => void;
}

/**
 * Implements core's registry, facts and quote ports on top of the Binance APIs.
 * Registry comes from the public lists (the authenticated RWA list is truncated and has no xStocks).
 * Status, reference price and listed price come from the authenticated RWA list; volume from the public v4 token endpoint.
 */
export class BinanceData {
  private readonly now: () => number;
  private readonly registryCache: TtlCache<{
    registry: Registry;
    listMultiplier: Map<string, bigint>;
  }>;
  private readonly authCache: TtlCache<Map<string, RwaToken>>;
  private readonly multCache: TtlCache<MultiplierReadings>;
  private readonly marketCache: TtlCache<TokenMarketFacts>;
  private readonly refCache: TtlCache<ReferencePrice | null>;

  constructor(private readonly o: BinanceDataOptions) {
    this.now = o.now ?? Date.now;
    this.registryCache = new TtlCache(TTL_MS.registry, this.now);
    this.authCache = new TtlCache(TTL_MS.status, this.now);
    this.multCache = new TtlCache(TTL_MS.multipliers, this.now);
    this.marketCache = new TtlCache(TTL_MS.status, this.now);
    this.refCache = new TtlCache(TTL_MS.referencePrice, this.now);
  }

  private warn(message: string, e: unknown) {
    this.o.onWarn?.(`${message}: ${e instanceof Error ? e.message : String(e)}`);
  }

  private loadRegistry() {
    return this.registryCache.get("all", async () => {
      const lists = await Promise.all(
        (["ondo", "xstocks", "bstock"] as const).map((i) => this.o.pub.list(i)),
      );
      const rows: RegistryRow[] = [];
      const listMultiplier = new Map<string, bigint>();
      for (const row of lists.flat()) {
        if (row.chainId !== "56") continue;
        const issuer = ISSUER_BY_TYPE[row.type];
        if (!issuer) continue;
        rows.push({
          ticker: row.ticker,
          issuer,
          address: row.contractAddress,
          symbol: row.symbol,
          decimals: row.d,
          assetType: row.assetType ?? 0,
        });
        if (row.multiplier)
          listMultiplier.set(row.contractAddress.toLowerCase(), parseDecimal(row.multiplier, 18));
      }
      return { registry: Registry.fromRows(rows), listMultiplier };
    });
  }

  private authTokens() {
    return this.authCache.get("rwa", async () => {
      try {
        const list = await this.o.api.rwaTokens();
        return new Map(
          list
            .filter((t) => t.binanceChainId === "56")
            .map((t) => [t.tokenContractAddress.toLowerCase(), t]),
        );
      } catch (e) {
        if (isKindedError(e) && FATAL.has(e.kind)) throw e;
        this.warn(
          "authenticated RWA list unavailable, status and reference price fall back to public data",
          e,
        );
        return new Map<string, RwaToken>(); // status becomes "unknown", never assumed open
      }
    });
  }

  readonly ports: Pick<EnginePorts, "registry" | "facts" | "quotes"> = {
    registry: {
      tokensFor: async (ticker) => (await this.loadRegistry()).registry.tokensFor(ticker),
    },
    facts: {
      multipliers: (token) => this.multCache.get(token.address, () => this.readMultipliers(token)),
      market: (token) => this.marketCache.get(token.address, () => this.readMarket(token)),
      reference: (ticker) => this.refCache.get(ticker, () => this.readReference(ticker)),
    },
    quotes: { quote: (token, amountIn, wallet) => this.quote(token, amountIn, wallet) },
  };

  /** BNB price for the fee display, from a small BNB quote. */
  bnbUsd(wallet: string): Promise<number> {
    return this.o.api.bnbUsd(wallet);
  }

  private async readMultipliers(token: RegistryToken): Promise<MultiplierReadings> {
    const { listMultiplier } = await this.loadRegistry();
    const auth = (await this.authTokens()).get(token.address);
    const readings: MultiplierReadings = {};
    const list = listMultiplier.get(token.address);
    if (list !== undefined) readings.list = list;
    if (auth?.tokenToShareRatio) readings.api = parseDecimal(auth.tokenToShareRatio, 18);
    if (this.o.onchain && token.issuer !== "ondo") {
      try {
        const v = await this.o.onchain(token);
        if (v !== undefined) readings.onchain = v;
      } catch (e) {
        this.warn(`on-chain multiplier read failed for ${token.symbol}, using the API reading`, e);
      }
    }
    return readings;
  }

  private async readMarket(token: RegistryToken): Promise<TokenMarketFacts> {
    const auth = (await this.authTokens()).get(token.address);
    const facts: TokenMarketFacts = { status: statusFromInfo(auth?.statusInfo) };
    if (auth?.tokenPrice) facts.listedTokenPrice = Number(auth.tokenPrice);
    try {
      const d = await this.o.pub.tokenDynamic(token.address);
      facts.onchainVolume24hUsd = Number(d.volume24hBuy ?? 0) + Number(d.volume24hSell ?? 0);
      if (!facts.listedTokenPrice && d.price) facts.listedTokenPrice = Number(d.price);
    } catch (e) {
      this.warn(`on-chain volume unavailable for ${token.symbol}: ghost check skipped`, e);
    }
    if (!auth) {
      // Not in the (truncated) authenticated list. The public dynamic endpoint has statusInfo for Ondo only.
      try {
        const dyn = await this.o.pub.rwaDynamic(token.address);
        facts.status = statusFromInfo(dyn.statusInfo);
        if (!facts.listedTokenPrice && dyn.tokenInfo?.price)
          facts.listedTokenPrice = Number(dyn.tokenInfo.price);
      } catch (e) {
        this.warn(`status unknown for ${token.symbol}`, e);
      }
    }
    return facts;
  }

  /** US price per SHARE: the authenticated `referencePrice ÷ tokenToShareRatio` of any issuer token (bStock's public `stockInfo.price` is null, V15). */
  private async readReference(ticker: string): Promise<ReferencePrice | null> {
    const { registry } = await this.loadRegistry();
    const auth = await this.authTokens();
    const tokens = registry.tokensFor(ticker);
    let session: Session = "unknown";
    let price: number | undefined;
    for (const t of tokens) {
      const a = auth.get(t.address);
      if (!a) continue;
      const s = sessionFromMarketStatus(a.statusInfo?.marketStatus);
      if (session === "unknown" && s !== "unknown") session = s;
      // `referencePrice` in the authenticated list is a fair value per TOKEN (it already includes the share multiplier):
      // NFLXon 680.80 is 10 shares of ~$68.08, and NVDAon/NVDAB give 231.66/231.63 per share only after dividing by
      // `tokenToShareRatio`. Dividing makes two issuers agree to 0.01%; not dividing misprices Ondo NFLX by 10×.
      if (price === undefined && a.referencePrice)
        price = Number(a.referencePrice) / Number(a.tokenToShareRatio ?? 1);
    }
    if (price === undefined) {
      for (const t of tokens) {
        try {
          const dyn = await this.o.pub.rwaDynamic(t.address);
          const p = dyn.stockInfo?.price;
          if (p) {
            price = Number(p);
            const s = sessionFromMarketStatus(dyn.statusInfo?.marketStatus);
            if (session === "unknown") session = s;
            break;
          }
        } catch (e) {
          this.warn(`reference price lookup failed via ${t.symbol}`, e);
        }
      }
    }
    return price === undefined ? null : { price, session };
  }

  private async quote(token: RegistryToken, amountIn: bigint, wallet: Address): Promise<RawQuote> {
    const routes = await this.o.api.quoteRoutes({
      toToken: token.address,
      amount: amountIn,
      wallet,
    });
    const best = pickBest(routes);
    if (!best)
      throw new BinanceApiError(
        "token_unavailable",
        undefined,
        `no route for ${token.symbol}`,
        200,
        "/api/v1/dex/aggregator/quote",
      );
    if (best.toToken.tokenContractAddress.toLowerCase() !== token.address) {
      throw new BinanceApiError(
        "unknown",
        undefined,
        `quote is for ${best.toToken.tokenContractAddress}, expected ${token.address}`,
        200,
        "/api/v1/dex/aggregator/quote",
      );
    }
    return toRawQuote(best);
  }
}
