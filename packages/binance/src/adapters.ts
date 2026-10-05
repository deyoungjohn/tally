import { TTL_MS } from "@tally/config";
import {
  Registry,
  TtlCache,
  isKindedError,
  parseDecimal,
  sessionFromMarketStatus,
  statusFromInfo,
  type Address,
  type CorporateActionKind,
  type CorporateActionSighting,
  type PriceCheckInputs,
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
  /** Last accepted Ondo multipliers (data/ondo-multiplier-baseline.json). Optional: without it the bounds check is skipped. */
  baseline?: BaselineStore;
}

/** Where accepted Ondo multiplier readings and corporate-action sightings live. A JSON file now (packages/engine), SQLite later. */
export interface BaselineStore {
  get(address: string): { value: bigint; at: number } | undefined;
  /** The last time this token's status showed a corporate action, if ever. */
  getAction(address: string): CorporateActionSighting | undefined;
  /** Remember a corporate-action status (extends the current sighting, or starts a new one). */
  noteAction(token: RegistryToken, kind: CorporateActionKind, at: number): Promise<void>;
  /** Called only for readings that passed the bounds check. */
  record(token: RegistryToken, value: bigint, at: number): Promise<void>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
    /** When Binance's list says each multiplier last changed (`lastUpdateTime`, ms). */
    listChangedAt: Map<string, number>;
  }>;
  private readonly authCache: TtlCache<Map<string, RwaToken>>;
  private readonly multCache: TtlCache<MultiplierReadings>;
  private readonly marketCache: TtlCache<TokenMarketFacts>;
  private readonly refCache: TtlCache<ReferencePrice | null>;
  /** Set when the authenticated list could not be loaded, so status notes can say why. */
  private authError?: string;

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
      const listChangedAt = new Map<string, number>();
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
        if (row.lastUpdateTime)
          listChangedAt.set(row.contractAddress.toLowerCase(), row.lastUpdateTime);
      }
      return { registry: Registry.fromRows(rows), listMultiplier, listChangedAt };
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
      all: async () => (await this.loadRegistry()).registry.all(),
    },
    facts: {
      multipliers: (token) => this.multCache.get(token.address, () => this.readMultipliers(token)),
      market: (token) => this.marketCache.get(token.address, () => this.readMarket(token)),
      reference: (ticker) => this.refCache.get(ticker, () => this.readReference(ticker)),
      recordAccepted: async (token, value, at) => this.o.baseline?.record(token, value, at),
      noteCorporateAction: async (token, kind, at) => this.o.baseline?.noteAction(token, kind, at),
      priceCheck: (token) => this.readPriceCheck(token),
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
    const facts: TokenMarketFacts = { status: statusFromInfo(auth?.statusInfo), notes: {} };
    const notes = facts.notes!;
    if (auth?.tokenPrice) facts.listedTokenPrice = Number(auth.tokenPrice);
    try {
      const d = await this.o.pub.tokenDynamic(token.address);
      facts.onchainVolume24hUsd = Number(d.volume24hBuy ?? 0) + Number(d.volume24hSell ?? 0);
      if (!facts.listedTokenPrice && d.price) facts.listedTokenPrice = Number(d.price);
    } catch (e) {
      notes.volume = `public token-dynamic call failed: ${msg(e)}`;
      this.warn(`on-chain volume unavailable for ${token.symbol}: ghost check skipped`, e);
    }
    if (token.executable) await this.addAttestation(token, facts);
    else notes.attestation = "not fetched: this issuer is not executable through Tally";
    if (!auth) {
      // Not in the (truncated) authenticated list. The public dynamic endpoint has statusInfo for Ondo only.
      try {
        const dyn = await this.o.pub.rwaDynamic(token.address);
        facts.status = statusFromInfo(dyn.statusInfo);
        if (!facts.status)
          notes.status = `not in the authenticated list${this.authError ? ` (${this.authError})` : ""}; the public dynamic data has no statusInfo for this issuer`;
        if (!facts.listedTokenPrice && dyn.tokenInfo?.price)
          facts.listedTokenPrice = Number(dyn.tokenInfo.price);
      } catch (e) {
        notes.status = `not in the authenticated list${this.authError ? ` (${this.authError})` : ""}; public dynamic call failed: ${msg(e)}`;
        this.warn(`status unknown for ${token.symbol}`, e);
      }
    }
    if (facts.listedTokenPrice === undefined)
      notes.listedPrice = "no listed token price from any source";
    // Ondo has no on-chain multiplier, so its readings are checked against the last accepted one (§7.3).
    if (token.issuer === "ondo") {
      facts.multiplierBaseline = this.o.baseline?.get(token.address);
      facts.corporateAction = this.o.baseline?.getAction(token.address);
      facts.multiplierChangedAt = (await this.loadRegistry()).listChangedAt.get(token.address);
    }
    return facts;
  }

  /**
   * Latest dated attestation report. Ondo publishes `protections.dailyAttestationReport.url` with the date in the file
   * name; bStock only has an undated `collateralReport`. Every outcome is written to `notes.attestation` so the integrity
   * log can say WHY a token has no attestation check: not fetched, call failed, or no dated report.
   */
  private async addAttestation(token: RegistryToken, facts: TokenMarketFacts): Promise<void> {
    const notes = facts.notes!;
    let profile;
    try {
      profile = await this.o.api.underlyingProfile(token.address);
    } catch (e) {
      if (isKindedError(e) && FATAL.has(e.kind)) throw e;
      notes.attestation = `underlying-profile call failed: ${msg(e)}`;
      this.warn(`attestation unavailable for ${token.symbol}`, e);
      return;
    }
    const url = profile.protections?.dailyAttestationReport?.url;
    const date = url ? /daily-(\d{4}-\d{2}-\d{2})/.exec(url) : null;
    if (url && date) {
      facts.attestation = { reportDate: date[1]!, url };
      return;
    }
    const kinds = Object.keys(profile.protections ?? {});
    notes.attestation = url
      ? `daily report url has no date in its file name (${url})`
      : `no dated daily report (protections: ${kinds.length ? kinds.join(", ") : "none"}${kinds.length ? "; urls empty" : ""})`;
  }

  /**
   * Inputs for the independent price check, from the public RWA dynamic data: `tokenInfo.price` (one token) and
   * `stockInfo.price` (US price per share). The authenticated list's `tokenPrice` is NOT used: for Ondo NFLX it is ten
   * times the price the quote API returns. Called only when a multiplier changed, so it costs one public call, rarely.
   */
  private async readPriceCheck(token: RegistryToken): Promise<PriceCheckInputs> {
    try {
      const d = await this.o.pub.rwaDynamic(token.address);
      const tokenPrice = d.tokenInfo?.price ? Number(d.tokenInfo.price) : undefined;
      const stockPrice = d.stockInfo?.price ? Number(d.stockInfo.price) : undefined;
      return {
        tokenPrice,
        stockPrice,
        note:
          tokenPrice && stockPrice
            ? undefined
            : "public RWA dynamic data has no token or stock price",
      };
    } catch (e) {
      this.warn(`price check inputs unavailable for ${token.symbol}`, e);
      return { note: `public RWA dynamic call failed: ${msg(e)}` };
    }
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
