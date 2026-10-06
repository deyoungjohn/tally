import type { Issuer } from "@tally/core";

export type { Issuer };
export interface PieTemplate {
  id: string;
  name: string;
  description: string;
  executable: boolean;
  holdings: { ticker: string; targetWeightBps: number }[];
}
/** Structural subset of WO-03's Holding; tokens retain their native RAW units. */
export interface PieHolding {
  tokenContractAddress: string;
  ticker: string;
  issuer: Issuer | null;
  balanceTokens: bigint;
  balanceShares: bigint | null;
  sharesUnavailableReason?: string;
}
export interface PiePrice {
  usdPerShareE18: bigint | null;
  reason?: string;
}
export type PiePrices = Readonly<Record<string, PiePrice>>;
export interface MissingFact {
  ticker: string;
  reason: string;
  tokenContractAddress?: string;
}
export interface PieValue {
  ticker: string;
  valueE18: bigint;
  weightBps: number;
}
export interface PieTarget extends PieValue {
  driftBps: number;
}
export interface BuyIssuer {
  issuer: Issuer;
  tokenContractAddress: string;
}
interface LegBase {
  id: string;
  sequence: number;
  ticker: string;
  issuer: Issuer;
  tokenContractAddress: string;
  valueE18: bigint;
}
export interface SellLeg extends LegBase {
  side: "sell";
  amountTokens: bigint;
  amountSharesE18: bigint;
  assumedProceedsUsdtE18: bigint;
}
export interface BuyLeg extends LegBase {
  side: "buy";
  amountUsdtE18: bigint;
}
export type PieLeg = SellLeg | BuyLeg;
export type DeferredLeg = PieLeg & { reason: string };
export interface RebalanceInput {
  template: PieTemplate;
  holdings: readonly PieHolding[];
  prices: PiePrices;
  buyable: ReadonlySet<string>;
  walletUsdtE18: bigint;
  mode: "rebalance" | { invest: bigint };
  driftThresholdBps?: number;
  minOrderUsdtE18?: bigint;
  sellHaircutBps?: number;
  bestIssuer(ticker: string): BuyIssuer | null;
}
export interface PieTotals {
  currentValueE18: bigint;
  targetValueE18: bigint;
  walletUsdtE18: bigint;
  sellValueE18: bigint;
  assumedSellProceedsUsdtE18: bigint;
  buyBudgetUsdtE18: bigint;
  buyUsdtE18: bigint;
  unspentUsdtE18: bigint;
  deferredSellValueE18: bigint;
  deferredBuyUsdtE18: bigint;
}
export interface RebalancePlan {
  before: PieValue[];
  target: PieTarget[];
  legs: PieLeg[];
  deferred: DeferredLeg[];
  unavailable: MissingFact[];
  excluded: MissingFact[];
  totals: PieTotals;
  notes: string[];
  reason: string | null;
}
export type LegStatus = "pending" | "done" | "failed" | "skipped";
export interface PieRun {
  id: string;
  wallet: string;
  pieId: string;
  createdAt: number;
  legs: { id: string; status: LegStatus; txHash?: string; reason?: string }[];
}
