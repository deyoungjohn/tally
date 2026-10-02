import { E18, formatUnits, mulDiv } from "./units";
import type { Issuer, MultiplierReadings } from "./types";

export type ResolvedSource = "onchain" | "api" | "list";

export interface ResolvedMultiplier {
  value: bigint;
  source: ResolvedSource;
  /** The preferred source for this issuer did not answer, so a weaker one was used. */
  degraded: boolean;
  /** Largest pairwise difference between the sources that answered, in parts per million. */
  maxDeviationPpm: number;
  /** Sources differ by more than 0.1% (blueprint §7.5). */
  disagree: boolean;
}

export const DISAGREE_PPM = 1_000; // 0.1%

/** Source of truth (blueprint §7.3): on-chain for bStock and xStocks, the API for Ondo (it has no on-chain multiplier). */
const PREFERRED: Record<Issuer, ResolvedSource[]> = {
  bstock: ["onchain", "api", "list"],
  xstocks: ["onchain", "api", "list"],
  ondo: ["api", "list"],
};

export function deviationPpm(a: bigint, b: bigint): number {
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  if (lo <= 0n) return Number.POSITIVE_INFINITY;
  return Number(mulDiv(hi - lo, 1_000_000n, lo));
}

export function resolveMultiplier(
  issuer: Issuer,
  readings: MultiplierReadings,
): ResolvedMultiplier | null {
  const order = PREFERRED[issuer];
  const present = (["onchain", "api", "list"] as const).filter(
    (k) => readings[k] !== undefined && readings[k]! > 0n,
  );
  const chosen = order.find((k) => readings[k] !== undefined && readings[k]! > 0n);
  if (!chosen) return null;
  let maxDev = 0;
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      maxDev = Math.max(maxDev, deviationPpm(readings[present[i]!]!, readings[present[j]!]!));
    }
  }
  return {
    value: readings[chosen]!,
    source: chosen,
    degraded: chosen !== order[0],
    maxDeviationPpm: maxDev,
    disagree: maxDev > DISAGREE_PPM,
  };
}

export interface OndoBoundsInput {
  current: bigint;
  /** Last accepted reading (the baseline). Without one only a sanity check is possible. */
  previous?: { value: bigint; at: number };
  /** `statusInfo.reasonMsg` text, searched for a corporate action. */
  reasonMsg?: string | null;
}

export type BoundsOutcome = "pass" | "fail" | "skipped";
export interface OndoBoundsResult {
  outcome: BoundsOutcome;
  /** One line with the numbers: "1.0017152 vs baseline 1.0017152 (seen 2026-09-30): unchanged". */
  detail: string;
}

/** An increase of up to 3% in one step is accepted: Ondo multipliers jump on ex-dividend dates (PFE ≈ +1.5% in one day). */
export const JUMP_LIMIT_PPM = 30_000;

const fmt = (v: bigint) => formatUnits(v, 18, 8);

/**
 * Ondo multiplier bounds (blueprint §7.3): never decreases; a single increase of up to 3% is accepted; above 3% needs a
 * matching corporate action (`stock_split` / `stock_dividend` in `statusInfo.reasonMsg`). There is deliberately no
 * per-day growth cap: ex-dividend jumps would trip it. A failing reading is flagged and blocks execution for that token.
 */
export function checkOndoMultiplier(i: OndoBoundsInput): OndoBoundsResult {
  if (i.current <= 0n)
    return { outcome: "fail", detail: `multiplier ${i.current} is zero or negative` };
  if (!i.previous)
    return {
      outcome: "skipped",
      detail: `${fmt(i.current)}: no baseline for this token, only checked for sanity`,
    };
  const prev = i.previous.value;
  const base = `${fmt(i.current)} vs baseline ${fmt(prev)} (seen ${new Date(i.previous.at).toISOString().slice(0, 10)})`;
  if (i.current === prev) return { outcome: "pass", detail: `${base}: unchanged` };
  if (i.current < prev) return { outcome: "fail", detail: `${base}: decreased` };
  const ppm = Number(mulDiv(i.current - prev, 1_000_000n, prev));
  const pct = `+${(ppm / 10_000).toFixed(3)}%`;
  if (ppm <= JUMP_LIMIT_PPM)
    return { outcome: "pass", detail: `${base}: ${pct}, within the 3% single-step limit` };
  if (/stock_split|stock_dividend/i.test(i.reasonMsg ?? ""))
    return {
      outcome: "pass",
      detail: `${base}: ${pct}, above 3% but a corporate action is listed`,
    };
  return { outcome: "fail", detail: `${base}: ${pct}, above 3% with no corporate action` };
}

/** "Unit trap" (blueprint §7.5): the same ticker means a very different amount of stock depending on the issuer. */
export const UNIT_TRAP_RATIO_PPM = 1_250_000; // 1.25×

export function isUnitTrap(own: bigint, others: bigint[]): boolean {
  return others.some((o) => {
    const lo = own < o ? own : o;
    const hi = own < o ? o : own;
    return lo > 0n && mulDiv(hi, 1_000_000n, lo) >= BigInt(UNIT_TRAP_RATIO_PPM);
  });
}

export function sharesFromTokens(tokens: bigint, multiplier: bigint): bigint {
  return mulDiv(tokens, multiplier, E18);
}
