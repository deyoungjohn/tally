/**
 * Pure portfolio suggestions builder (WO-03 / wo03-portfolio-suggestions.md).
 * Suggests liquid, guarantee-enabled stocks for wallets that hold fewer than 3 stocks,
 * rotated deterministically per wallet address.
 */

export interface PortfolioSuggestionItem {
  ticker: string;
  symbol: string;
  issuer: "ondo" | "bstock" | "xstocks";
  name: string;
  grade: "A" | "B";
  label: "Liquid";
  volume24hUsd: string;
  reason: string;
}

export type PortfolioSuggestionsState = "ok" | "none_needed" | "unavailable";

export interface PortfolioSuggestions {
  count: number;
  items: PortfolioSuggestionItem[];
  state: PortfolioSuggestionsState;
  reasonText: string;
}

export interface CandidateTokenInput {
  ticker: string;
  symbol: string;
  issuer: "ondo" | "bstock" | "xstocks";
  name: string;
  address?: string;
  grade: "A" | "B" | "C" | "D" | "F";
  score?: number;
  ghost?: boolean;
  stale?: boolean;
  /** Cleaned on-chain 24h volume in USD (bigint, number, or string). */
  cleanedVolumeUsd?: bigint | number | string | null;
  reason?: string;
}

export interface HoldingValueInput {
  ticker: string;
  valueUsdE18?: bigint;
  valueUsd?: number;
}

export type HeldInput = ReadonlySet<string> | readonly string[] | readonly HoldingValueInput[];

export interface BuildSuggestionsOptions {
  /** Wallet address (used only for deterministic rotation offset; never stored). */
  walletAddress?: string | null;
  /** Held tickers or holdings with values. Dust (< $1) does not count. */
  held?: HeldInput;
  /** Available candidate tokens with radar grade and liquidity. */
  candidates: readonly CandidateTokenInput[];
  /** Radar data availability and freshness flags. */
  radarStale?: boolean;
  radarMissing?: boolean;
  isFixture?: boolean;
}

const E18 = 10n ** 18n;
export const SUGGESTIONS_REASON_TEXT =
  "Enabled in Tally's guarantee and liquid right now. Not advice.";
export const SUGGESTIONS_CATCHING_UP_TEXT = "Liquidity data is catching up";
export const SUGGESTIONS_FIXTURE_TEXT = "Fixture data";

/**
 * Fast, stable 32-bit FNV-1a hash of a wallet address for rotation.
 * Pure function: same address always returns the same integer.
 */
export function addressHash(address: string): number {
  const norm = address.toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    hash ^= norm.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash >>> 0);
}

/** Converts volume input to integer USD value for sorting. */
function toSortableVolume(vol: bigint | number | string | null | undefined): bigint {
  if (vol === null || vol === undefined) return 0n;
  if (typeof vol === "bigint") {
    // If it's already in 1e18 wei fixed-point, convert to whole dollars for sorting
    return vol >= E18 ? vol / E18 : vol;
  }
  if (typeof vol === "number") {
    return BigInt(Math.floor(vol));
  }
  const parsed = Number(vol);
  return Number.isFinite(parsed) ? BigInt(Math.floor(parsed)) : 0n;
}

/** Formats volume input to a clean whole-dollar USD string. */
export function formatVolumeUsdString(vol: bigint | number | string | null | undefined): string {
  if (vol === null || vol === undefined) return "0";
  if (typeof vol === "string") {
    const num = Number(vol);
    if (!Number.isFinite(num)) return "0";
    return Math.floor(num).toString();
  }
  if (typeof vol === "number") {
    return Math.floor(vol).toString();
  }
  // BigInt
  if (vol >= E18) {
    return (vol / E18).toString();
  }
  return vol.toString();
}

/**
 * Extracts the set of distinct held tickers with non-dust balance (>= $1).
 * Tickers with total value < $1 are dust and do NOT count.
 */
export function extractNonDustHeldTickers(held?: HeldInput): Set<string> {
  const nonDust = new Set<string>();
  if (!held) return nonDust;

  if (held instanceof Set) {
    for (const t of held) nonDust.add(t.toUpperCase());
    return nonDust;
  }

  if (Array.isArray(held)) {
    if (held.length === 0) return nonDust;

    // Check if it's an array of strings
    if (typeof held[0] === "string") {
      for (const t of held as string[]) nonDust.add(t.toUpperCase());
      return nonDust;
    }

    // Array of objects with ticker and value
    const tickerTotalsE18 = new Map<string, bigint>();
    for (const item of held as HoldingValueInput[]) {
      const ticker = item.ticker.toUpperCase();
      let valE18 = 0n;
      if (item.valueUsdE18 !== undefined) {
        valE18 = item.valueUsdE18;
      } else if (item.valueUsd !== undefined) {
        valE18 = BigInt(Math.floor(item.valueUsd * 1e18));
      } else {
        // If no value is specified, assume non-dust
        valE18 = E18;
      }
      tickerTotalsE18.set(ticker, (tickerTotalsE18.get(ticker) ?? 0n) + valE18);
    }

    for (const [ticker, total] of tickerTotalsE18.entries()) {
      if (total >= E18) {
        nonDust.add(ticker);
      }
    }
  }

  return nonDust;
}

/**
 * Pure builder for portfolio suggestions.
 */
export function buildPortfolioSuggestions(opts: BuildSuggestionsOptions): PortfolioSuggestions {
  const distinctHeld = extractNonDustHeldTickers(opts.held);
  const heldCount = distinctHeld.size;

  // Rule: holds 0 -> 3, holds 1 -> 2, holds 2 -> 1, holds 3 or more -> none
  const needed = Math.max(0, 3 - heldCount);

  if (needed === 0) {
    return {
      count: 0,
      items: [],
      state: "none_needed",
      reasonText: "",
    };
  }

  const unavailableReason = opts.isFixture
    ? SUGGESTIONS_FIXTURE_TEXT
    : SUGGESTIONS_CATCHING_UP_TEXT;

  // Radar missing or stale check
  if (opts.radarMissing || opts.radarStale) {
    return {
      count: 0,
      items: [],
      state: "unavailable",
      reasonText: unavailableReason,
    };
  }

  // Filter candidates:
  // 1. Not already held by the wallet
  // 2. Graded A or B ("Liquid")
  // 3. Not a ghost
  // 4. Not stale
  const eligible = opts.candidates.filter((c) => {
    if (distinctHeld.has(c.ticker.toUpperCase())) return false;
    if (c.grade !== "A" && c.grade !== "B") return false;
    if (c.ghost === true) return false;
    if (c.stale === true) return false;
    return true;
  });

  if (eligible.length === 0) {
    return {
      count: 0,
      items: [],
      state: "unavailable",
      reasonText: unavailableReason,
    };
  }

  // Group candidate tokens by ticker: pick the issuer with better current liquidity
  const byTicker = new Map<string, CandidateTokenInput>();
  for (const token of eligible) {
    const ticker = token.ticker.toUpperCase();
    const existing = byTicker.get(ticker);
    if (!existing) {
      byTicker.set(ticker, token);
    } else {
      const volExisting = toSortableVolume(existing.cleanedVolumeUsd);
      const volToken = toSortableVolume(token.cleanedVolumeUsd);
      if (volToken > volExisting) {
        byTicker.set(ticker, token);
      } else if (volToken === volExisting) {
        // Tie-breaker: score if available
        const scoreExisting = existing.score ?? 0;
        const scoreToken = token.score ?? 0;
        if (scoreToken > scoreExisting) {
          byTicker.set(ticker, token);
        }
      }
    }
  }

  // Order candidate tickers by cleaned on-chain 24h volume, highest first
  const sorted = [...byTicker.values()].sort((a, b) => {
    const volA = toSortableVolume(a.cleanedVolumeUsd);
    const volB = toSortableVolume(b.cleanedVolumeUsd);
    if (volB !== volA) return volB > volA ? 1 : -1;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  // Top 8 pool
  const pool = sorted.slice(0, 8);
  if (pool.length === 0) {
    return {
      count: 0,
      items: [],
      state: "unavailable",
      reasonText: unavailableReason,
    };
  }

  // Rotate starting point by stable hash of wallet address
  let rotated = pool;
  if (opts.walletAddress && opts.walletAddress.trim()) {
    const offset = addressHash(opts.walletAddress) % pool.length;
    rotated = [...pool.slice(offset), ...pool.slice(0, offset)];
  }

  const selected = rotated.slice(0, needed);
  const items: PortfolioSuggestionItem[] = selected.map((c) => ({
    ticker: c.ticker.toUpperCase(),
    symbol: c.symbol,
    issuer: c.issuer,
    name: c.name,
    grade: c.grade as "A" | "B",
    label: "Liquid",
    volume24hUsd: formatVolumeUsdString(c.cleanedVolumeUsd),
    reason: c.reason ?? "Liquid on-chain",
  }));

  return {
    count: items.length,
    items,
    state: "ok",
    reasonText: SUGGESTIONS_REASON_TEXT,
  };
}
