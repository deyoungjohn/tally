import type { Issuer, Session } from "@tally/core";
export type { Issuer, Session } from "@tally/core";

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertEvidence {
  snapshotKind: string;
  snapshotKey: string;
  observedAt: number;
}

export interface Alert {
  id: string;
  walletAddress: string;
  rule: string;
  ticker: string;
  issuer: Issuer;
  severity: AlertSeverity;
  title: string;
  body: string;
  evidence: AlertEvidence;
  createdAt: number;
}

export interface UserHolding {
  walletAddress: string;
  tokenAddress: string;
  ticker: string;
  issuer: Issuer;
  tokens: bigint;
  shares: bigint;
}

export interface TokenStatusState {
  kind: "open" | "limited" | "paused" | "unsupported" | "unknown";
  reasonCode: string | null;
  reasonMsg: string | null;
  session: Session;
}

export interface TokenState {
  tokenAddress: string;
  ticker: string;
  issuer: Issuer;
  status: TokenStatusState | null;
  multiplier: bigint | null;
  grade: "A" | "B" | "C" | "D" | "F" | null;
  gradeReasons: string[];
  ghost: boolean | null;
  lastRealTradeAgeDays?: number | null;
  sharePriceUsd: number | null;
  session: Session;
  observedAt: number;
  isPausedOnchain: boolean | null;
  evidenceKey?: string;
}

/**
 * Minimal contract with WO-04's README snapshots (packages/mod-flow/README.md).
 * Declare only the fields Guardian reads, not complete copies of RadarSnapshotRow
 * or GhostCheck, which remain in motion across parallel work orders.
 */
export interface RadarSnapshotSubset {
  ticker: string;
  address: string;
  issuer: Issuer;
  grade: "A" | "B" | "C" | "D" | "F";
  ghost: boolean;
  reasons?: string[];
}

export interface FlowGhostSnapshotSubset {
  id: string;
  outcome: "pass" | "deduct" | "skipped";
  points: number;
  ghost: boolean | null;
  reason: string;
}

export interface FlowAggregateSubset {
  ticker: string;
  issuer: Issuer;
  address: string;
  lastRealTradeAt: number | null;
  lastRealTradeAgeMs: number | null;
  lastRealTradeReason: string | null;
}

export interface QuietHours {
  enabled: boolean;
  startHourUtc: number; // 0-23 in UTC
  endHourUtc: number; // 0-23 in UTC
}

export interface GuardianSettings {
  enabled: boolean;
  rules: {
    paused: boolean;
    shareCount: boolean;
    gradeDrop: boolean;
    ghost: boolean;
    priceThreshold: boolean;
    earnings: boolean;
  };
  priceThresholds?: Record<
    string,
    {
      minPriceUsd?: number;
      maxPriceUsd?: number;
    }
  >;
  quietHours?: QuietHours;
  cooldownMs?: number;
}

export const DEFAULT_GUARDIAN_SETTINGS: GuardianSettings = {
  enabled: true,
  rules: {
    paused: true,
    shareCount: true,
    gradeDrop: true,
    ghost: true,
    priceThreshold: true,
    earnings: false,
  },
  quietHours: {
    enabled: false,
    startHourUtc: 22,
    endHourUtc: 7,
  },
  cooldownMs: 86_400_000, // 24 hours
};
