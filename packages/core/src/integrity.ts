import type { Session, TokenStatus } from "./types";

export type Grade = "A" | "B" | "C" | "D" | "F";
export type IntegrityFlag =
  | "ghost"
  | "unit-trap"
  | "multiplier-disagreement"
  | "paused"
  | "unsupported"
  | "stale-price"
  | "bounds";

export interface IntegrityInput {
  multiplierDisagree: boolean;
  /** Premium vs the US price as a fraction (0.0012 = +0.12%); undefined when no price is available. */
  premium?: number;
  session: Session;
  onchainVolume24hUsd?: number;
  status: TokenStatus | null;
  attestationAgeDays?: number;
  unitTrap: boolean;
  /** Ondo multiplier bounds were violated. */
  boundsViolation?: string;
}

export interface Deduction {
  points: number;
  flag?: IntegrityFlag;
  reason: string;
}

export interface Integrity {
  score: number;
  grade: Grade;
  flags: IntegrityFlag[];
  /** Plain-English reason per deduction (blueprint §7.5). */
  reasons: Deduction[];
  /** Badge only, no points. */
  unitTrap: boolean;
}

export function gradeFromScore(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

/** Integrity grade A–F (blueprint §7.5): start at 100, subtract per condition. */
export function gradeIntegrity(i: IntegrityInput): Integrity {
  const reasons: Deduction[] = [];
  if (i.multiplierDisagree) {
    reasons.push({
      points: 25,
      flag: "multiplier-disagreement",
      reason: "Data sources disagree on how many shares one token is (more than 0.1%).",
    });
  }
  if (i.boundsViolation) {
    // Not in the §7.5 table: flagged and blocks execution (consolidate.ts), but costs no grade points.
    reasons.push({
      points: 0,
      flag: "bounds",
      reason: `Share multiplier looks wrong: ${i.boundsViolation}.`,
    });
  }
  if (i.session === "regular" && i.premium !== undefined && Math.abs(i.premium) > 0.02) {
    reasons.push({
      points: 30,
      flag: "stale-price",
      reason: `Price is ${(i.premium * 100).toFixed(1)}% away from the US price during market hours.`,
    });
  }
  if (i.onchainVolume24hUsd !== undefined && i.onchainVolume24hUsd < 1_000) {
    reasons.push({
      points: 40,
      flag: "ghost",
      reason: `Almost no trading on BNB Chain ($${Math.round(i.onchainVolume24hUsd).toLocaleString("en-US")} in 24h). Prices can be stale.`,
    });
  }
  if (i.status === null) {
    reasons.push({ points: 10, reason: "Trading status is unknown." });
  } else if (i.status.kind === "paused") {
    reasons.push({
      points: 50,
      flag: "paused",
      reason: `Trading is paused${i.status.reasonMsg ? ` (${i.status.reasonMsg})` : ""}.`,
    });
  } else if (i.status.kind === "unsupported") {
    reasons.push({
      points: 50,
      flag: "unsupported",
      reason: "Binance does not support trading this token right now.",
    });
  } else if (i.status.kind === "limited") {
    reasons.push({ points: 10, reason: "Trading is limited (for example around earnings)." });
  } else if (i.status.kind === "unknown") {
    reasons.push({
      points: 10,
      reason: `Trading status is unclear (${i.status.reasonCode ?? "no code"}).`,
    });
  }
  if (i.attestationAgeDays !== undefined && i.attestationAgeDays > 3) {
    reasons.push({
      points: 10,
      reason: `Latest reserve attestation is ${Math.floor(i.attestationAgeDays)} days old.`,
    });
  }
  const score = Math.max(0, 100 - reasons.reduce((s, r) => s + r.points, 0));
  return {
    score,
    grade: gradeFromScore(score),
    flags: reasons
      .flatMap((r) => (r.flag ? [r.flag] : []))
      .concat(i.unitTrap ? ["unit-trap" as const] : []),
    reasons,
    unitTrap: i.unitTrap,
  };
}
