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
  isMax?: boolean;
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
  tokens?: string;
  max?: boolean;
  rawBalance?: string;
  user?: Address;
}): Promise<SellSheetVM> {
  const ticker = params?.ticker?.toUpperCase() ?? "NVDA";
  const issuer = params?.issuer ?? "bstock";
  const isMax = Boolean(params?.max);
  const rawTokens = params?.tokens ?? (isMax ? params?.rawBalance : undefined);

  return {
    state: "empty",
    ticker,
    issuer,
    symbol: issuer === "bstock" ? `${ticker}B` : `${ticker}on`,
    stock: "",
    tokensIn: rawTokens ?? "0",
    sharesIn: "0",
    quotedUsdtOut: "0",
    minUsdtFloor: "0",
    usdPerShare: 0,
    referencePrice: null,
    costPct: null,
    feeEstimateUsd: null,
    integrityGrade: null,
    availabilityReason: "A sell plan needs a live quote; open a sell from the Portfolio.",
    isMax,
    stale: false,
    ageMs: null,
    source: null,
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
    availabilityReason:
      "Single-route switch is unavailable: upstream Binance DEX aggregator forbids stock-to-stock pairing on BNB Chain (code 40368: Ondo asset on chain 56 can only pair with allowed stablecoins). Use Sell then Buy as two separate steps.",
    directRoute: false,
    twoStepRequired: false,
    stale: false,
    ageMs: null,
    source: null,
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
