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

/** Everything about a token that is not its quote. Status `null` means "unknown" and is never assumed open. */
export interface TokenMarketFacts {
  status: TokenStatus | null;
  /** Price per TOKEN as listed by data APIs (not a fill price). Used to flag stale or ghost listings. */
  listedTokenPrice?: number;
  /** On-chain 24h buy + sell volume in USD. */
  onchainVolume24hUsd?: number;
  /** Age of the latest attestation report, when the token has `protections`. */
  attestationAgeDays?: number;
  /** Ondo only: last accepted multiplier reading, for the monotonic/growth bounds (§7.3). */
  multiplierBaseline?: { value: bigint; at: number };
  /** Annual dividend yield as a fraction, for the Ondo growth bound. */
  dividendYield?: number;
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
