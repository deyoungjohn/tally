import { E18 } from "@tally/core";
import type { Alert, DecisionRow, Policy, Position } from "./types";

/** Constructed test/preview vectors; no real wallet observations or execution evidence. */
export const CONSTRUCTED_NOW = Date.UTC(2026, 9, 6, 15);
export const CONSTRUCTED_WALLET = "0x0000000000000000000000000000000000000001";
export const CONSTRUCTED_TOKEN = "0x0000000000000000000000000000000000000002";
export function constructedAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "constructed-alert",
    walletAddress: CONSTRUCTED_WALLET,
    rule: "grade-drop",
    ticker: "NFLX",
    issuer: "ondo",
    severity: "critical",
    createdAt: CONSTRUCTED_NOW,
    evidence: {
      snapshotKind: "radar",
      snapshotKey: CONSTRUCTED_TOKEN,
      observedAt: CONSTRUCTED_NOW,
    },
    ...overrides,
  };
}
export function constructedPolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    armedRules: { "grade-drop": { atOrBelow: "D" } },
    tokenAllowList: [CONSTRUCTED_TOKEN],
    killSwitch: false,
    ...overrides,
  };
}
export function constructedPosition(overrides: Partial<Position> = {}): Position {
  return {
    walletAddress: CONSTRUCTED_WALLET,
    tokenAddress: CONSTRUCTED_TOKEN,
    ticker: "NFLX",
    issuer: "ondo",
    chainBalanceTokens: 10n * E18,
    balanceSource: "chain",
    tokenDecimals: 18,
    shares: 100n * E18,
    multiplier: 10n * E18,
    usdPerShare: E18,
    grade: "D",
    paused: false,
    pausedSince: null,
    observedAt: CONSTRUCTED_NOW,
    ...overrides,
  };
}
export function constructedRow(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    alertId: "previous-alert",
    walletAddress: CONSTRUCTED_WALLET,
    rule: "grade-drop",
    decidedAt: CONSTRUCTED_NOW,
    mode: "shadow",
    decision: "execute",
    reasons: [],
    leg: { ticker: "NFLX", issuer: "ondo", tokens: E18, usdCap: 10n * E18 },
    inputs: {
      alert: constructedAlert(),
      policy: constructedPolicy(),
      position: constructedPosition(),
      spentToday: 0n,
      regularSession: null,
    },
    ...overrides,
  };
}
