import type { Address, Issuer } from "@tally/core";

export type { Address, Issuer };

export interface MultiplierObservation {
  multiplier: bigint;
  observedAt?: number;
  source?: string;
}

export interface ToSharesResult {
  amountShares: bigint | null;
  multiplier: bigint | null;
  convertedAtTodaysRatio: boolean;
  sharesUnavailableReason?: string;
}

export interface TokenRegistryInfo {
  ticker: string;
  issuer: Issuer | null;
  symbol?: string;
  decimals?: number;
  tokenToShareRatio?: bigint;
}

export type TokenRegistryLookup = (address: string) => TokenRegistryInfo | undefined;

export interface MultiplierEntry {
  multiplier: bigint;
  isTodaysRatio?: boolean;
  source?: string;
}

export type MultiplierMap = Record<string, MultiplierEntry | bigint>;

export interface HoldingRowActionMeta {
  token: string;
  issuer: Issuer | null;
  balanceTokens: string;
  balanceShares: string | null;
  ticker: string;
}

export interface Holding {
  tokenContractAddress: string;
  tokenSymbol: string;
  ticker: string;
  issuer: Issuer | null;
  isRecognized: boolean;
  unrecognizedReason?: string;
  balanceTokens: bigint;
  multiplier: bigint | null;
  balanceShares: bigint | null;
  sharesUnavailableReason?: string;
  convertedAtTodaysRatio: boolean;
  tokenBalanceUsdE18: bigint;
  costBasisUsdE18: bigint;
  avgCostPerShareUsdE18: bigint | null;
  pricePerShareUsdE18: bigint | null;
  unrealizedPnlUsdE18: bigint;
  source: string;
  rowActionsSlot?: HoldingRowActionMeta;
}

export interface Trade {
  txHash: string;
  time: number;
  type: "BUY" | "SELL";
  tokenContractAddress: string;
  tokenSymbol: string;
  ticker: string;
  issuer: Issuer | null;
  isRecognized: boolean;
  unrecognizedReason?: string;
  amountTokens: bigint;
  multiplier: bigint | null;
  amountShares: bigint | null;
  sharesUnavailableReason?: string;
  convertedAtTodaysRatio: boolean;
  pricePerTokenUsdE18: bigint;
  pricePerShareUsdE18: bigint | null;
  valueUsdE18: bigint;
  realizedPnlUsdE18?: bigint;
}

export interface PnlLine {
  tokenContractAddress: string;
  tokenSymbol: string;
  ticker: string;
  issuer: Issuer | null;
  isRecognized: boolean;
  realizedPnlUsdE18: bigint;
  buyVolumeUsdE18: bigint;
  sellVolumeUsdE18: bigint;
  buyTxCount: number;
  sellTxCount: number;
  lastActiveTimestamp: number;
  holdingShares?: bigint | null;
}

export interface StatementReceipt {
  id: string;
  txHash?: string;
  tokenContractAddress: string;
  tokenSymbol: string;
  ticker: string;
  issuer: Issuer;
  side: "BUY" | "SELL";
  tokens: bigint;
  shares: bigint;
  multiplier: bigint;
  usdSpentOrReceivedE18: bigint;
  executedAt: number;
  status?: "RECONCILED" | "RECONCILED_WITH_DIFFERENCE" | "PENDING" | "FAILED" | "UNRECONCILED";
}

export interface TickerHoldingsGroup {
  ticker: string;
  totalShares: bigint;
  totalValueUsdE18: bigint;
  totalCostBasisUsdE18: bigint;
  avgCostPerShareUsdE18: bigint | null;
  unrealizedPnlUsdE18: bigint;
  issuers: Holding[];
  hasUnavailableShares: boolean;
}

export interface Statement {
  walletAddress: string;
  asOf: number | null;
  asOfReason?: string;
  holdingsByTicker: Record<string, TickerHoldingsGroup>;
  holdings: Holding[];
  unrecognizedHoldings: Holding[];
  trades: Trade[];
  pnlLines: PnlLine[];
  totalValueUsdE18: bigint;
  totalCostBasisUsdE18: bigint;
  totalRealizedPnlUsdE18: bigint;
  totalUnrealizedPnlUsdE18: bigint;
  differsFromApi: boolean;
  differsFromApiNote?: string;
  convertedAtTodaysRatioCount: number;
  notes: string[];
  source: "api" | "receipts" | "mixed";
}
