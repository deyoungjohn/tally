import type { BoundsOutcome } from "./multiplier";
import type { ResolvedMultiplier } from "./multiplier";
import { formatUnits } from "./units";
import type { AttestationFact, FactKey, MultiplierReadings, Session, TokenStatus } from "./types";

export type Grade = "A" | "B" | "C" | "D" | "F";
export type IntegrityFlag =
  | "ghost"
  | "unit-trap"
  | "multiplier-disagreement"
  | "paused"
  | "unsupported"
  | "stale-price"
  | "bounds";

export type CheckId =
  | "multiplier-sources"
  | "ondo-bounds"
  | "premium"
  | "onchain-volume"
  | "status"
  | "attestation"
  | "unit-trap";
/** pass: ran, fine. deduct: ran, cost points. flag: ran, no points but flagged (blocks or badges). skipped: could not or need not run. */
export type CheckOutcome = "pass" | "deduct" | "flag" | "skipped";

/**
 * One line of the integrity log. EVERY check writes one, passes and skips included, so a clean score can always be
 * explained ("report 2026-09-29, age 3.2d → −10", "field empty → skipped"), and a missing deduction is visible.
 */
export interface CheckRecord {
  id: CheckId;
  outcome: CheckOutcome;
  /** Points deducted (0 unless outcome is "deduct"). */
  points: number;
  /** Human-readable inputs and outcome on one line. */
  summary: string;
  /** The same inputs as data, for `--json` and tests. */
  inputs: Record<string, unknown>;
  flag?: IntegrityFlag;
  /** Plain-English reason shown to users (deductions and flags only). */
  reason?: string;
}

export interface IntegrityInput {
  /** Resolved multiplier and the raw readings behind it. */
  multiplier?: ResolvedMultiplier | null;
  readings?: MultiplierReadings;
  /** Ondo bounds result; undefined for issuers that read on-chain (check is not applicable). */
  bounds?: { outcome: BoundsOutcome; detail: string };
  /** Premium vs the US price as a fraction (0.0012 = +0.12%); undefined when no price is available. */
  premium?: number;
  /** Where the premium came from: a Binance quote, or the listed token price of a token we did not quote. */
  premiumBasis?: "quote" | "listed price";
  session: Session;
  onchainVolume24hUsd?: number;
  status: TokenStatus | null;
  attestation?: AttestationFact;
  /** Current time (ms), to age the attestation. */
  now: number;
  unitTrap: boolean;
  /** Reasons for missing facts, from the adapters. */
  notes?: Partial<Record<FactKey, string>>;
}

export interface Integrity {
  score: number;
  grade: Grade;
  flags: IntegrityFlag[];
  /** Deductions and flags with plain-English reasons (what the UI shows). */
  reasons: CheckRecord[];
  /** The full log: all seven checks, every time. */
  checks: CheckRecord[];
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

const ATTESTATION_MAX_AGE_DAYS = 3;
const DAY_MS = 86_400_000;
const PREMIUM_LIMIT = 0.02;
const GHOST_VOLUME_USD = 1_000;
const usd0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
const m = (v: bigint | undefined) => (v === undefined ? "–" : formatUnits(v, 18, 6));

export function attestationAgeDays(a: AttestationFact, now: number): number {
  const [y, mo, d] = a.reportDate.split("-").map(Number);
  return (now - Date.UTC(y!, mo! - 1, d!)) / DAY_MS;
}

/** Integrity grade A–F (blueprint §7.5): start at 100, subtract per condition, and log every check. */
export function gradeIntegrity(i: IntegrityInput): Integrity {
  const checks: CheckRecord[] = [];
  const note = (k: FactKey) => i.notes?.[k];

  // 1. Multiplier sources agree (−25 if they differ by more than 0.1%)
  {
    const r = i.readings ?? {};
    const inputs = {
      onchain: m(r.onchain),
      api: m(r.api),
      list: m(r.list),
      maxDeviationPpm: i.multiplier?.maxDeviationPpm,
      used: i.multiplier?.source,
    };
    const seen = `onchain ${m(r.onchain)}, api ${m(r.api)}, list ${m(r.list)}`;
    if (!i.multiplier) {
      checks.push({
        id: "multiplier-sources",
        outcome: "skipped",
        points: 0,
        inputs,
        summary: `no multiplier from any source (${seen}) → skipped`,
      });
    } else if (i.multiplier.disagree) {
      checks.push({
        id: "multiplier-sources",
        outcome: "deduct",
        points: 25,
        flag: "multiplier-disagreement",
        inputs,
        summary: `${seen}; max difference ${i.multiplier.maxDeviationPpm} ppm > 1000 → −25`,
        reason: "Data sources disagree on how many shares one token is (more than 0.1%).",
      });
    } else {
      checks.push({
        id: "multiplier-sources",
        outcome: "pass",
        points: 0,
        inputs,
        summary: `${seen}; max difference ${i.multiplier.maxDeviationPpm} ppm ≤ 1000, using ${i.multiplier.source}${i.multiplier.degraded ? " (degraded: preferred source missing)" : ""} → pass`,
      });
    }
  }

  // 2. Ondo bounds (flag only, blocks execution; not a grade deduction in the §7.5 table)
  if (!i.bounds) {
    checks.push({
      id: "ondo-bounds",
      outcome: "skipped",
      points: 0,
      inputs: {},
      summary: "not applicable: this issuer's multiplier is read on-chain → skipped",
    });
  } else if (i.bounds.outcome === "fail") {
    checks.push({
      id: "ondo-bounds",
      outcome: "flag",
      points: 0,
      flag: "bounds",
      inputs: { detail: i.bounds.detail },
      summary: `${i.bounds.detail} → flagged, blocks execution (0 pts)`,
      reason: `Share multiplier looks wrong: ${i.bounds.detail}.`,
    });
  } else {
    checks.push({
      id: "ondo-bounds",
      outcome: i.bounds.outcome === "skipped" ? "skipped" : "pass",
      points: 0,
      inputs: { detail: i.bounds.detail },
      summary: `${i.bounds.detail} → ${i.bounds.outcome === "skipped" ? "skipped" : "pass"}`,
    });
  }

  // 3. Premium vs the US price (−30 if |premium| > 2% during regular hours)
  {
    const inputs = { premium: i.premium, basis: i.premiumBasis, session: i.session };
    if (i.premium === undefined) {
      checks.push({
        id: "premium",
        outcome: "skipped",
        points: 0,
        inputs,
        summary: `no ${note("listedPrice") ? "listed price" : "price or reference"} to compare${note("listedPrice") ? ` (${note("listedPrice")})` : ""} → skipped`,
      });
    } else if (i.session !== "regular") {
      checks.push({
        id: "premium",
        outcome: "skipped",
        points: 0,
        inputs,
        summary: `premium ${pct(i.premium)} (${i.premiumBasis}); session ${i.session}, the 2% rule applies in regular hours only → skipped`,
      });
    } else if (Math.abs(i.premium) > PREMIUM_LIMIT) {
      checks.push({
        id: "premium",
        outcome: "deduct",
        points: 30,
        flag: "stale-price",
        inputs,
        summary: `premium ${pct(i.premium)} (${i.premiumBasis}) in a regular session, beyond ±2% → −30`,
        reason: `Price is ${(i.premium * 100).toFixed(1)}% away from the US price during market hours.`,
      });
    } else {
      checks.push({
        id: "premium",
        outcome: "pass",
        points: 0,
        inputs,
        summary: `premium ${pct(i.premium)} (${i.premiumBasis}) in a regular session, within ±2% → pass`,
      });
    }
  }

  // 4. On-chain volume (−40 if under $1,000 in 24h: a ghost market)
  {
    const inputs = { onchainVolume24hUsd: i.onchainVolume24hUsd };
    if (i.onchainVolume24hUsd === undefined) {
      checks.push({
        id: "onchain-volume",
        outcome: "skipped",
        points: 0,
        inputs,
        summary: `volume unknown${note("volume") ? ` (${note("volume")})` : ""} → skipped, ghost check not run`,
      });
    } else if (i.onchainVolume24hUsd < GHOST_VOLUME_USD) {
      checks.push({
        id: "onchain-volume",
        outcome: "deduct",
        points: 40,
        flag: "ghost",
        inputs,
        summary: `${usd0(i.onchainVolume24hUsd)} in 24h < ${usd0(GHOST_VOLUME_USD)} → −40`,
        reason: `Almost no trading on BNB Chain (${usd0(i.onchainVolume24hUsd)} in 24h). Prices can be stale.`,
      });
    } else {
      checks.push({
        id: "onchain-volume",
        outcome: "pass",
        points: 0,
        inputs,
        summary: `${usd0(i.onchainVolume24hUsd)} in 24h ≥ ${usd0(GHOST_VOLUME_USD)} → pass`,
      });
    }
  }

  // 5. Trading status (−10 unknown, −10 limited, −50 paused/unsupported)
  {
    const s = i.status;
    const inputs = {
      kind: s?.kind ?? null,
      reasonCode: s?.reasonCode ?? null,
      reasonMsg: s?.reasonMsg ?? null,
    };
    if (s === null) {
      checks.push({
        id: "status",
        outcome: "deduct",
        points: 10,
        inputs,
        summary: `status unknown${note("status") ? ` (${note("status")})` : ""} → −10`,
        reason: "Trading status is unknown.",
      });
    } else if (s.kind === "paused") {
      checks.push({
        id: "status",
        outcome: "deduct",
        points: 50,
        flag: "paused",
        inputs,
        summary: `paused (${s.reasonCode}${s.reasonMsg ? `: ${s.reasonMsg}` : ""}) → −50`,
        reason: `Trading is paused${s.reasonMsg ? ` (${s.reasonMsg})` : ""}.`,
      });
    } else if (s.kind === "unsupported") {
      checks.push({
        id: "status",
        outcome: "deduct",
        points: 50,
        flag: "unsupported",
        inputs,
        summary: `unsupported (${s.reasonCode}) → −50`,
        reason: "Binance does not support trading this token right now.",
      });
    } else if (s.kind === "limited") {
      checks.push({
        id: "status",
        outcome: "deduct",
        points: 10,
        inputs,
        summary: `limited (${s.reasonCode}) → −10`,
        reason: "Trading is limited (for example around earnings).",
      });
    } else if (s.kind === "unknown") {
      checks.push({
        id: "status",
        outcome: "deduct",
        points: 10,
        inputs,
        summary: `unrecognised status code ${s.reasonCode ?? "none"} → −10`,
        reason: `Trading status is unclear (${s.reasonCode ?? "no code"}).`,
      });
    } else {
      checks.push({
        id: "status",
        outcome: "pass",
        points: 0,
        inputs,
        summary: `open (${s.reasonCode}), session ${s.session} → pass`,
      });
    }
  }

  // 6. Attestation (−10 if the latest dated report is more than 3 calendar days old)
  {
    if (!i.attestation) {
      checks.push({
        id: "attestation",
        outcome: "skipped",
        points: 0,
        inputs: { note: note("attestation") },
        summary: `${note("attestation") ?? "no attestation data"} → skipped`,
      });
    } else {
      const age = attestationAgeDays(i.attestation, i.now);
      const inputs = {
        reportDate: i.attestation.reportDate,
        ageDays: Number(age.toFixed(2)),
        url: i.attestation.url,
        now: new Date(i.now).toISOString(),
      };
      if (age > ATTESTATION_MAX_AGE_DAYS) {
        checks.push({
          id: "attestation",
          outcome: "deduct",
          points: 10,
          inputs,
          summary: `report ${i.attestation.reportDate}, age ${age.toFixed(1)}d > ${ATTESTATION_MAX_AGE_DAYS}d → −10`,
          reason: `Latest reserve attestation is ${Math.floor(age)} days old.`,
        });
      } else {
        checks.push({
          id: "attestation",
          outcome: "pass",
          points: 0,
          inputs,
          summary: `report ${i.attestation.reportDate}, age ${age.toFixed(1)}d ≤ ${ATTESTATION_MAX_AGE_DAYS}d → pass`,
        });
      }
    }
  }

  // 7. Unit trap (badge, no points)
  checks.push(
    i.unitTrap
      ? {
          id: "unit-trap",
          outcome: "flag",
          points: 0,
          flag: "unit-trap",
          inputs: {},
          summary:
            "multiplier differs ≥ 1.25× from another issuer's for this ticker → badge, 0 pts",
          reason:
            "One token of this issuer is a different amount of stock than another issuer's token.",
        }
      : {
          id: "unit-trap",
          outcome: "pass",
          points: 0,
          inputs: {},
          summary: "multipliers within 1.25× of the other issuers' → pass",
        },
  );

  const score = Math.max(0, 100 - checks.reduce((s, c) => s + c.points, 0));
  return {
    score,
    grade: gradeFromScore(score),
    flags: checks.flatMap((c) => (c.flag ? [c.flag] : [])),
    reasons: checks.filter((c) => c.reason),
    checks,
    unitTrap: i.unitTrap,
  };
}
