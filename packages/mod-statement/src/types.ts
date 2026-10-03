import type { Address, Issuer } from "@tally/core";

export type { Address, Issuer };

export interface MultiplierObservation {
  multiplier: bigint;
  observedAt?: number;
  source?: string;
}

export interface ToSharesResult {
  amountShares: bigint;
  multiplier: bigint;
  convertedAtTodaysRatio: boolean;
}

export interface Holding {
  tokenContractAddress: string;
  tokenSymbol: string;
  ticker: string;
  issuer: Issuer;
  balanceTokens: bigint;
  multiplier: bigint;
  balanceShares: bigint;
  convertedAtTodaysRatio: boolean;
  tokenBalanceUsd: number;
  pricePerShareUsd: number;
  costBasisUsd: number;
  avgCostPerShareUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPercent: number;
  source: string;
}

export interface Trade {
  txHash: string;
  time: number;
  type: "BUY" | "SELL";
  tokenContractAddress: string;
  tokenSymbol: string;
  ticker: string;
  issuer: Issuer;
  amountTokens: bigint;
  multiplier: bigint;
  amountShares: bigint;
  convertedAtTodaysRatio: boolean;
  pricePerTokenUsd: number;
  pricePerShareUsd: number;
  valueUsd: number;
  realizedPnlUsd?: number;
}

export interface PnlLine {
  tokenContractAddress: string;
  tokenSymbol: string;
  ticker: string;
  issuer: Issuer;
  realizedPnlUsd: number;
  realizedPnlPercent: number;
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  buyTxCount: number;
  sellTxCount: number;
  lastActiveTimestamp: number;
  holdingShares?: bigint;
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
  usdSpentOrReceived: number;
  executedAt: number;
  status?: "RECONCILED" | "RECONCILED_WITH_DIFFERENCE" | "PENDING" | "FAILED" | "UNRECONCILED";
}

export interface TickerHoldingsGroup {
  ticker: string;
  totalShares: bigint;
  totalValueUsd: number;
  totalCostBasisUsd: number;
  avgCostPerShareUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPercent: number;
  issuers: Holding[];
}

export interface Statement {
  walletAddress: string;
  asOf: number;
  holdingsByTicker: Record<string, TickerHoldingsGroup>;
  holdings: Holding[];
  trades: Trade[];
  pnlLines: PnlLine[];
  totalValueUsd: number;
  totalCostBasisUsd: number;
  totalRealizedPnlUsd: number;
  totalUnrealizedPnlUsd: number;
  differsFromApi: boolean;
  differsFromApiNote?: string;
  convertedAtTodaysRatioCount: number;
  notes: string[];
  source: "api" | "receipts" | "mixed";
}
