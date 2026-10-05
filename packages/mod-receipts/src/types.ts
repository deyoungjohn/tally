import type { Address, Issuer } from "@tally/core";

export type Hex = `0x${string}`;
export type ReceiptStatus =
  "RECONCILED" | "RECONCILED_WITH_DIFFERENCE" | "PENDING" | "FAILED" | "UNRECONCILED";
export interface TokenAmount {
  asset: Address;
  raw: bigint;
  decimals: number;
}

/** Stock-output operations; direct stablecoin-output sells need a separate minimum-out model. */
export interface Intent {
  id: string;
  kind: "buy" | "switch" | "rewardsToStock" | "sell";
  ticker: string;
  asset: Address;
  issuer: Issuer;
  tokenDecimals: number;
  user: Address;
  recipient: Address;
  spend: TokenAmount;
  minShares: bigint;
  toleranceBps: number;
  approvedAt: number | null;
  /** Null for legacy direct-router transactions; never invent a Guarded event. */
  guard: Address | null;
}
export interface QuoteRecord {
  quoteId: string | null;
  expectedOut: TokenAmount;
  /** One entry per hop, not the API's count of alternative routes. */
  route: readonly string[];
  router: Address;
  observedAt: number | null;
  expiresAt: number | null;
  notes: readonly string[];
}
export interface SimulationRecord {
  expectedOut: TokenAmount;
  gasLimit: bigint;
  observedAt: number;
  source: "transaction-api+eth_call" | "historical-eth_call";
  /** Historical reconstructions stay distinguishable from the original simulation. */
  block: bigint | null;
  notes: readonly string[];
}
export interface Conversion {
  /** Shares per whole token, 1e18 fixed point; frozen at this observation. */
  multiplier: bigint;
  tokenDecimals: number;
  source: string;
  observationId: string;
  observedAt: number | null;
  observedAtReason: string | null;
}
export interface ChainLog {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  transactionHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  removed: boolean;
}
export interface GuardedEvent {
  user: Address;
  recipient: Address;
  stock: Address;
  tokenIn: Address;
  amountIn: bigint;
  tokensOut: bigint;
  shares: bigint;
  multiplier: bigint;
  router: Address;
}
export interface TransferEvent {
  from: Address;
  to: Address;
  value: bigint;
}
export interface Realized {
  txHash: Hex;
  block: bigint | null;
  status: "pending" | "success" | "reverted";
  gasUsed: bigint | null;
  gasLimit: bigint | null;
  /** Full logs from this transaction; pure decoders validate and extract events. */
  logs: readonly ChainLog[];
  /** Standard receipts omit revert bytes; retain their reason/provenance. */
  revertData: Hex | null;
  failureReason: string | null;
}
export type Receipt = {
  intent: Intent;
  quote: QuoteRecord | null;
  quoteMissingReason: string | null;
  conversion: Conversion | null;
  conversionMissingReason: string | null;
  txHash: Hex | null;
  realized: Realized | null;
  notes: readonly string[];
} & (
  | { simulation: SimulationRecord; simulationMissingReason: null }
  | { simulation: null; simulationMissingReason: string }
);
export interface Reconciliation {
  status: ReceiptStatus;
  diffVsQuoteBps: number | null;
  diffVsSimBps: number | null;
  tokensReceived: bigint | null;
  tokensSpent: bigint | null;
  sharesReceived: bigint | null;
  guarded: GuardedEvent | null;
  notes: string[];
}
