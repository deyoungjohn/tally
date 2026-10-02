/**
 * Merged block list for Tally (TALLY_BLUEPRINT.md §9).
 *
 * Every entry records WHERE it came from, so a reviewer can re-check it. Add new
 * sources here, never as ad-hoc checks elsewhere. Entries marked `verified: false`
 * are enforced (we fail closed) but still need a human to confirm the source text.
 */

export type BlockSource =
  "hackathon" | "binance-web3-api" | "issuer" | "wallet-provider" | "ops-policy";

export interface BlockedCountry {
  /** ISO 3166-1 alpha-2, as sent by Cloudflare in `cf-ipcountry`. */
  code: string;
  name: string;
  sources: BlockSource[];
  /** Where the entry is written down. */
  evidence: string;
  verified: boolean;
}

export interface BlockedSubRegion {
  /** ISO 3166-1 alpha-2 country. */
  country: string;
  /** ISO 3166-2 subdivision code (without the country prefix), as in `cf-region-code`. */
  regionCode: string;
  name: string;
  sources: BlockSource[];
  evidence: string;
  verified: boolean;
}

const HACKATHON = "bnbhackathon.md restricted participants and regions (TALLY_BLUEPRINT.md §2)";

export const BLOCKED_COUNTRIES: readonly BlockedCountry[] = [
  {
    code: "US",
    name: "United States",
    sources: ["hackathon", "binance-web3-api"],
    evidence: `${HACKATHON}; Binance Web3 API returns 40304 to US callers (IDEAS.md F3)`,
    verified: true,
  },
  { code: "CA", name: "Canada", sources: ["hackathon"], evidence: HACKATHON, verified: true },
  { code: "NL", name: "Netherlands", sources: ["hackathon"], evidence: HACKATHON, verified: true },
  { code: "IR", name: "Iran", sources: ["hackathon"], evidence: HACKATHON, verified: true },
  { code: "CU", name: "Cuba", sources: ["hackathon"], evidence: HACKATHON, verified: true },
  { code: "KP", name: "North Korea", sources: ["hackathon"], evidence: HACKATHON, verified: true },
  {
    code: "GB",
    name: "United Kingdom",
    sources: ["hackathon"],
    evidence: HACKATHON,
    verified: true,
  },
  { code: "JP", name: "Japan", sources: ["hackathon"], evidence: HACKATHON, verified: true },
  // Binance's own prohibited-jurisdiction list is referenced from the blueprint but not yet
  // copied in (IDEAS.md F9). Sudan is a fail-closed placeholder until it is confirmed.
  {
    code: "SY",
    name: "Syria",
    sources: ["wallet-provider", "binance-web3-api", "ops-policy"],
    evidence:
      "Privy Acceptable Use Policy (updated 2025-12-16) lists Syria; Binance prohibited-jurisdiction list still to confirm",
    verified: true,
  },
  {
    code: "SD",
    name: "Sudan",
    sources: ["binance-web3-api", "ops-policy"],
    evidence: "Binance prohibited-jurisdiction list (to confirm)",
    verified: false,
  },
];

export const BLOCKED_SUBREGIONS: readonly BlockedSubRegion[] = [
  {
    country: "UA",
    regionCode: "43",
    name: "Crimea",
    sources: ["hackathon", "wallet-provider"],
    evidence: HACKATHON,
    verified: false,
  },
  {
    country: "UA",
    regionCode: "40",
    name: "Sevastopol",
    sources: ["hackathon"],
    evidence: `${HACKATHON} (Crimea)`,
    verified: false,
  },
  {
    country: "UA",
    regionCode: "14",
    name: "Donetsk",
    sources: ["hackathon", "wallet-provider"],
    evidence: HACKATHON,
    verified: false,
  },
  {
    country: "UA",
    regionCode: "09",
    name: "Luhansk",
    sources: ["hackathon", "wallet-provider"],
    evidence: HACKATHON,
    verified: false,
  },
];

/**
 * Cloudflare pseudo country codes. `XX` = unknown, `T1` = Tor. Both are blocked
 * (blueprint §9 enforcement 1).
 */
export const BLOCKED_PSEUDO_COUNTRIES: Readonly<Record<string, string>> = {
  XX: "country could not be determined",
  T1: "Tor exit node",
};

const COUNTRY_SET = new Set(BLOCKED_COUNTRIES.map((c) => c.code));
const SUBREGION_SET = new Set(BLOCKED_SUBREGIONS.map((r) => `${r.country}-${r.regionCode}`));

export type GateReason = "country" | "subregion" | "unknown-country" | "tor" | "missing-header";

export interface GateDecision {
  blocked: boolean;
  reason?: GateReason;
}

export interface GateInput {
  /** Value of `cf-ipcountry`; undefined when the header is absent. */
  country: string | null | undefined;
  /** Value of `cf-region-code` (needs Cloudflare's "visitor location headers" transform). */
  regionCode?: string | null;
}

/**
 * Decide whether a request may see the site.
 *
 * Fail closed: a missing `cf-ipcountry` header means the request did not come through
 * Cloudflare (or the tunnel is misconfigured), so it is blocked in production. Local
 * development opts out through `allowMissingHeader`.
 */
export function evaluateRegion(
  input: GateInput,
  opts: { allowMissingHeader?: boolean } = {},
): GateDecision {
  const raw = input.country?.trim().toUpperCase();
  if (!raw) {
    return opts.allowMissingHeader
      ? { blocked: false }
      : { blocked: true, reason: "missing-header" };
  }
  if (raw === "T1") return { blocked: true, reason: "tor" };
  if (raw === "XX") return { blocked: true, reason: "unknown-country" };
  if (COUNTRY_SET.has(raw)) return { blocked: true, reason: "country" };
  const region = input.regionCode?.trim().toUpperCase();
  if (region && SUBREGION_SET.has(`${raw}-${region}`))
    return { blocked: true, reason: "subregion" };
  return { blocked: false };
}
