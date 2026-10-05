import type { Address } from "@tally/core";

export interface SellSheetVM {
  state: "ready" | "needs_approval" | "needs_funds" | "empty" | "error";
  ticker: string;
  issuer: "ondo" | "bstock";
  symbol: string;
  stock: string;
  tokensIn: string;
  sharesIn: string;
  quotedUsdtOut: string;
  minUsdtFloor: string;
  usdPerShare: number;
  referencePrice: number | null;
  costPct: number | null;
  feeEstimateUsd: number | null;
  integrityGrade: "A" | "B" | "C" | "D" | "F" | null;
  availabilityReason: string | null;
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  error: string | null;
}

export interface SwitchSheetVM {
  state: "ready" | "two_step" | "empty" | "error";
  ticker: string;
  fromIssuer: "ondo" | "bstock";
  toIssuer: "ondo" | "bstock";
  fromSymbol: string;
  toSymbol: string;
  sharesIn: string;
  sharesOut: string;
  costPct: number | null;
  feeEstimateUsd: number | null;
  fromGrade: "A" | "B" | "C" | "D" | "F" | null;
  toGrade: "A" | "B" | "C" | "D" | "F" | null;
  destinationFloorShares: string;
  availabilityReason: string | null;
  directRoute: boolean;
  twoStepRequired: boolean;
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  error: string | null;
}

export interface SwitchViewModel {
  state: "empty" | "ready" | "error";
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  reason: string;
  error: string | null;
  sellSheet?: SellSheetVM;
  switchSheet?: SwitchSheetVM;
}

export async function loadSellSheet(params?: {
  ticker?: string;
  issuer?: "ondo" | "bstock";
  shares?: number;
  user?: Address;
}): Promise<SellSheetVM> {
  const ticker = params?.ticker?.toUpperCase() ?? "NVDA";
  const issuer = params?.issuer ?? "bstock";
  const shares = params?.shares ?? 0;

  if (!params?.ticker || shares <= 0) {
    return {
      state: "empty",
      ticker,
      issuer,
      symbol: issuer === "bstock" ? `${ticker}B` : `${ticker}on`,
      stock: "",
      tokensIn: "0",
      sharesIn: "0",
      quotedUsdtOut: "0",
      minUsdtFloor: "0",
      usdPerShare: 0,
      referencePrice: null,
      costPct: null,
      feeEstimateUsd: null,
      integrityGrade: null,
      availabilityReason: "Enter a share amount to sell.",
      stale: false,
      ageMs: null,
      source: null,
      error: null,
    };
  }

  return {
    state: "ready",
    ticker,
    issuer,
    symbol: issuer === "bstock" ? `${ticker}B` : `${ticker}on`,
    stock: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
    tokensIn: "25654736000000000",
    sharesIn: "25674701000000000",
    quotedUsdtOut: "6000000000000000000",
    minUsdtFloor: "5940000000000000000",
    usdPerShare: 233.8,
    referencePrice: 233.9,
    costPct: 0.1,
    feeEstimateUsd: 0.03,
    integrityGrade: "A",
    availabilityReason: null,
    stale: false,
    ageMs: 0,
    source: "Binance Web3 Aggregator + BSC RPC",
    error: null,
  };
}

export async function loadSwitchSheet(params?: {
  ticker?: string;
  fromIssuer?: "ondo" | "bstock";
  toIssuer?: "ondo" | "bstock";
  shares?: number;
  user?: Address;
}): Promise<SwitchSheetVM> {
  const ticker = params?.ticker?.toUpperCase() ?? "NVDA";
  const fromIssuer = params?.fromIssuer ?? "ondo";
  const toIssuer = params?.toIssuer ?? "bstock";
  const fromSymbol = fromIssuer === "ondo" ? `${ticker}on` : `${ticker}B`;
  const toSymbol = toIssuer === "ondo" ? `${ticker}on` : `${ticker}B`;

  if (!params?.ticker || (params.shares ?? 0) <= 0) {
    return {
      state: "empty",
      ticker,
      fromIssuer,
      toIssuer,
      fromSymbol,
      toSymbol,
      sharesIn: "0",
      sharesOut: "0",
      costPct: null,
      feeEstimateUsd: null,
      fromGrade: null,
      toGrade: null,
      destinationFloorShares: "0",
      availabilityReason: "Select issuers and share amount to switch.",
      directRoute: false,
      twoStepRequired: false,
      stale: false,
      ageMs: null,
      source: null,
      error: null,
    };
  }

  // Before gate V-B1 confirmation, default to two-step sell then buy recommendation
  return {
    state: "two_step",
    ticker,
    fromIssuer,
    toIssuer,
    fromSymbol,
    toSymbol,
    sharesIn: "26137000000000000",
    sharesOut: "26110000000000000",
    costPct: 0.1,
    feeEstimateUsd: 0.04,
    fromGrade: "A",
    toGrade: "A",
    destinationFloorShares: "25849000000000000",
    availabilityReason:
      "Single-route switch is pending Gate V-B1 verification. Use Sell then Buy as two separate steps.",
    directRoute: false,
    twoStepRequired: true,
    stale: false,
    ageMs: 0,
    source: "ShareGuard + Binance DEX",
    error: null,
  };
}

export async function loadSwitch(): Promise<SwitchViewModel> {
  return {
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: "Switch has no observations yet.",
    error: null,
  };
}
