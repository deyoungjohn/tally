import type { Address } from "@tally/core";
import { isBuyable } from "../../lib/tickers";

export interface MigrateVM {
  state: "ready" | "needs_funds" | "empty" | "error";
  ticker: string;
  fromIssuer: "ondo" | "bstock" | "xstocks";
  toIssuer: "ondo" | "bstock";
  fromSymbol: string;
  toSymbol: string;
  sharesIn: string | null;
  tokensIn: string | null;

  // Eligibility
  availabilityReason: string | null;
  eligible: boolean;

  // Expected
  usdtExpected: string | null;

  // Metadata
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  error: string | null;
}

export async function loadMigrateSheet(params?: {
  ticker?: string;
  fromIssuer?: "ondo" | "bstock" | "xstocks";
  toIssuer?: "ondo" | "bstock";
  shares?: number;
  tokens?: string;
  rawBalance?: string;
  user?: Address;
  sellMinUsdt?: string;
  sellQuotedUsdt?: string;
}): Promise<MigrateVM> {
  const ticker = params?.ticker?.toUpperCase() ?? "NVDA";
  const fromIssuer = params?.fromIssuer ?? "ondo";
  const toIssuer = params?.toIssuer ?? (fromIssuer === "ondo" ? "bstock" : "ondo");
  const fromSymbol =
    fromIssuer === "ondo" ? `${ticker}on` : fromIssuer === "xstocks" ? `${ticker}x` : `${ticker}B`;
  const toSymbol = toIssuer === "ondo" ? `${ticker}on` : `${ticker}B`;

  const tokensIn = params?.tokens ?? params?.rawBalance ?? null;
  const usdtExpected = params?.sellQuotedUsdt ?? null;

  let eligible = true;
  let availabilityReason: string | null = null;

  if (fromIssuer === "xstocks") {
    eligible = false;
    availabilityReason = "No market to exit this token on BNB Chain";
  } else if (!isBuyable(ticker)) {
    eligible = false;
    availabilityReason = `${ticker} can't be bought through Tally yet.`;
  } else if (usdtExpected && BigInt(usdtExpected) < 6000000000000000000n) {
    eligible = false;
    availabilityReason =
      "Too small to migrate: the buy needs at least 6 USDT. You can sell to USDT instead.";
  }

  return {
    state: params?.user && eligible ? "ready" : "empty",
    ticker,
    fromIssuer,
    toIssuer,
    fromSymbol,
    toSymbol,
    sharesIn: params?.shares?.toString() ?? null,
    tokensIn,
    availabilityReason,
    eligible,
    usdtExpected,
    stale: false,
    ageMs: null,
    source: null,
    error: null,
  };
}

export async function loadMigrate(): Promise<{ reason: string }> {
  return { reason: "Migrate has no observations yet." };
}
