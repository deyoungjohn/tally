import { E18, mulDiv } from "./units";
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
  /** Last accepted reading and when it was taken (ms). Without a baseline only the absolute sanity bound applies. */
  previous?: { value: bigint; at: number };
  now: number;
  /** Annual dividend yield as a fraction (0.0032 for 0.32%). */
  dividendYield?: number;
  /** `statusInfo.reasonMsg` text, searched for a corporate action. */
  reasonMsg?: string | null;
}

export type OndoBoundsResult = { ok: true; note?: string } | { ok: false; reason: string };

const DAY_MS = 86_400_000;
const JUMP_LIMIT_PPM = 30_000; // 3%: bigger jumps need a corporate action
const EPSILON_PPM = 2_000; // 0.2% slack on the daily growth bound

/**
 * Ondo sanity bounds (blueprint §7.3): non-decreasing; per-day growth ≤ dividendYield/365 + ε; jumps above 3% only with a
 * matching corporate action (`stock_split` / `stock_dividend`). Violations are flagged and block execution for that token.
 */
export function checkOndoMultiplier(i: OndoBoundsInput): OndoBoundsResult {
  if (i.current <= 0n) return { ok: false, reason: "multiplier is zero or negative" };
  if (!i.previous) return { ok: true, note: "no baseline yet; only checked for sanity" };
  const prev = i.previous.value;
  const action = /stock_split|stock_dividend/i.test(i.reasonMsg ?? "");
  if (i.current === prev) return { ok: true };
  if (i.current < prev) {
    return action
      ? { ok: true, note: "decrease accepted: corporate action" }
      : { ok: false, reason: "multiplier decreased" };
  }
  const growthPpm = Number(mulDiv(i.current - prev, 1_000_000n, prev));
  if (growthPpm > JUMP_LIMIT_PPM) {
    return action
      ? { ok: true, note: "jump accepted: corporate action" }
      : {
          ok: false,
          reason: `jump of ${(growthPpm / 10_000).toFixed(2)}% without a corporate action`,
        };
  }
  const days = Math.max((i.now - i.previous.at) / DAY_MS, 1);
  const allowedPpm = ((i.dividendYield ?? 0) / 365) * days * 1_000_000 + EPSILON_PPM * days;
  if (growthPpm > allowedPpm) {
    return {
      ok: false,
      reason: `grew ${(growthPpm / 10_000).toFixed(3)}% in ${days.toFixed(1)}d, faster than the dividend yield explains`,
    };
  }
  return { ok: true };
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
