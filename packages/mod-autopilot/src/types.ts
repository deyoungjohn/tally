import type { Issuer } from "@tally/core";

/** Structural contract with Guardian's stored alerts; no Guardian internals imported. */
export interface Alert {
  id: string;
  walletAddress: string;
  rule: string;
  ticker: string;
  issuer: Issuer;
  severity: "info" | "warning" | "critical";
  createdAt: number;
  direction?: "min" | "max";
  evidence: { snapshotKind: string; snapshotKey: string; observedAt: number };
}

export type Grade = "A" | "B" | "C" | "D" | "F";
/** USD, share amounts and shares/token multiplier are all E18 fixed point. */
export interface PolicySettings {
  armedRules: {
    paused?: { longerThanHours: number };
    "grade-drop"?: { atOrBelow: "D" | "F" };
    "price-threshold"?: { stopUsdPerShare: bigint };
  };
  tokenAllowList: readonly string[];
  perTradeCap?: bigint;
  dailyCap?: bigint;
  killSwitch: boolean;
}
export interface Policy extends PolicySettings {
  isRegularSession?: (now: number) => boolean | null;
}

/** Normalized collector contract, not a Binance wallet balance or portfolio estimate. */
export interface Position {
  walletAddress: string;
  tokenAddress: string;
  ticker: string;
  issuer: Issuer;
  chainBalanceTokens: bigint | null;
  balanceSource: "chain" | "unknown";
  tokenDecimals: number;
  shares: bigint | null;
  multiplier: bigint | null;
  usdPerShare: bigint | null;
  grade: Grade | null;
  paused: boolean | null;
  pausedSince: number | null;
  observedAt: number;
}
export interface State {
  position: Position | null;
  rows: readonly DecisionRow[];
}
export interface Leg {
  ticker: string;
  issuer: Issuer;
  /** Raw token units, in tokenDecimals. Always sized from the chain balance. */
  tokens: bigint;
  usdCap: bigint;
}
export interface Decision {
  decision: "execute" | "alertOnly";
  reasons: string[];
  leg?: Leg;
}
export interface DecisionRow extends Decision {
  alertId: string;
  walletAddress: string;
  rule: string;
  decidedAt: number;
  mode: "shadow" | "live";
  receiptId?: string;
  /** Actual executed USD and execution time, not the proposed budget. */
  executedUsd?: bigint;
  executedAt?: number;
  inputs: {
    alert: Alert;
    policy: PolicySettings;
    position: Position | null;
    spentToday: bigint;
    regularSession: boolean | null;
  };
}
