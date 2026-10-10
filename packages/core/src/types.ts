export type Issuer = "ondo" | "bstock" | "xstocks";
export type Address = `0x${string}`;

/** Where the multiplier (shares per token, 1e18 fixed point) is read from, per issuer (blueprint §7.3). */
export type MultiplierSource = "onchain-uiMultiplier" | "onchain-multiplier" | "api";

export interface RegistryToken {
  ticker: string;
  issuer: Issuer;
  /** Lower-case address. Addresses only ever come from the registry, never from user input. */
  address: Address;
  symbol: string;
  decimals: number;
  assetType: number;
  multiplierSource: MultiplierSource;
  /** Issuer is bstock or ondo. A ghost market or a pause can still make a token non-executable at quote time. */
  executable: boolean;
}

/** Multiplier readings (1e18 fixed point) from each source that answered. */
export interface MultiplierReadings {
  onchain?: bigint;
  api?: bigint;
  list?: bigint;
}

export type Session = "regular" | "premarket" | "postmarket" | "overnight" | "closed" | "unknown";

export type StatusKind = "open" | "limited" | "paused" | "unsupported" | "unknown";
export interface TokenStatus {
  kind: StatusKind;
  reasonCode: string | null;
  reasonMsg: string | null;
  session: Session;
}

/** The latest dated attestation report. `reportDate` is YYYY-MM-DD, parsed from the report's file name (Ondo: `daily-2026-09-29.pdf`). */
export interface AttestationFact {
  reportDate: string;
  url: string;
}

/** Corporate-action codes that can justify a multiplier decrease or a jump above the step limit. `reasonMsg` is a bare code. */
export type CorporateActionKind = "stock_split" | "stock_dividend";
/** A status that showed a corporate action: first and last time we saw it (ms), so a halt that spans several polls is one sighting. */
export interface CorporateActionSighting {
  kind: CorporateActionKind;
  firstSeenAt: number;
  lastSeenAt: number;
}
/** Inputs for the independent price check of a multiplier change, from the public RWA dynamic data. */
export interface PriceCheckInputs {
  /** Price of one TOKEN (`tokenInfo.price`). */
  tokenPrice?: number;
  /** US price per SHARE (`stockInfo.price`). */
  stockPrice?: number;
  note?: string;
}

/** Facts that can be missing, each with a reason when it is (shown in the integrity check log as "skipped"). */
export type FactKey = "status" | "volume" | "attestation" | "listedPrice" | "priceCheck";

/** Everything about a token that is not its quote. Status `null` means "unknown" and is never assumed open. */
export interface TokenMarketFacts {
  status: TokenStatus | null;
  /** Price per TOKEN as listed by data APIs (not a fill price). Used to flag stale or ghost listings. */
  listedTokenPrice?: number;
  /** Onchain 24h buy + sell volume in USD. */
  onchainVolume24hUsd?: number;
  /** Latest dated attestation report. Age is computed in core from `now`, so it is testable. */
  attestation?: AttestationFact;
  /** Ondo only: last accepted multiplier reading (the baseline) for the bounds check (§7.3). `at` is when it was seen. */
  multiplierBaseline?: { value: bigint; at: number };
  /** Ondo only: when `statusInfo.reasonMsg` last showed a corporate-action code for this token (kept across runs). */
  corporateAction?: CorporateActionSighting;
  /** Ondo only: when Binance's list says the multiplier last changed (`lastUpdateTime`, ms), if it says. */
  multiplierChangedAt?: number;
  /** Why a fact is missing ("underlying-profile failed: 42900 …", "no dated daily report (protections: collateralReport)"). */
  notes?: Partial<Record<FactKey, string>>;
}

export interface ReferencePrice {
  /** US price per SHARE. */
  price: number;
  session: Session;
}

/** One hop of a route, reduced to what the UI shows. */
export interface RouteHop {
  dex: string;
  toSymbol: string;
}

/** Binance's quote, normalised so core never sees vendor JSON. */
export interface RawQuote {
  quoteId: string;
  vendor: string;
  executionMode: string;
  /** USDT spent, 18 decimals. */
  amountIn: bigint;
  /** Tokens received, in the token's decimals. */
  tokensOut: bigint;
  /** USD per 1 USDT as the API priced it. */
  usdtPrice: number;
  priceImpactPct: number;
  /** The API's own gas figure. Always 450000, shown for diagnostics only. Never used for fees or limits. */
  apiGas: number;
  hops: RouteHop[];
  /** Number of distinct sequential legs (parallel splits count once). */
  legCount: number;
  /** Contract the user must approve (and the router the guard calls), lower-case. */
  approveTarget: Address;
}

/** Errors thrown by ports carry a machine-readable kind so core can decide what is fatal. */
export type EngineErrorKind =
  | "region_block"
  | "compliance"
  | "auth"
  | "rate_limited"
  | "below_minimum"
  | "token_unavailable"
  | "quote_expired"
  | "param"
  | "upstream"
  | "network"
  | "unknown";

export interface KindedError extends Error {
  kind: EngineErrorKind;
  code?: number | string;
}

export function isKindedError(e: unknown): e is KindedError {
  return e instanceof Error && typeof (e as { kind?: unknown }).kind === "string";
}
