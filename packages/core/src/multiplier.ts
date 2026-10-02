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

/**
 * Largest single increase accepted without a corporate action. A JUDGEMENT threshold, not derived from data: the
 * largest step measured between 2026-09-30 and 2026-10-02 was +0.58% (research/ondo-multiplier-steps.md), so 3% is
 * about five times that. Revisit it when more steps have been observed.
 */
export const JUMP_LIMIT_PPM = 30_000;
/** A reverse split's new multiplier must be within 1% of old × ratio (slack for dividends accrued since the baseline). */
export const SPLIT_MATCH_PPM = 10_000;

export interface CorporateAction {
  kind: "stock_split" | "stock_dividend";
  /**
   * Shares per old share after the action: 10 for a 10-for-1 split, 0.1 for a 1-for-10 reverse split. Undefined when the
   * message carries no ratio we can read, in which case a decrease can never be verified and stays blocked.
   */
  ratio?: number;
}

/**
 * Reads a corporate action from `statusInfo.reasonMsg`. ASSUMPTION: no recorded message has carried a stock_split yet (the
 * only reasonMsg seen is "Paused for session transition"), so the ratio format ("1-for-10", "1:10", new:old) is a guess. It is safe
 * to be wrong: a misread ratio also has to match old × ratio on the multiplier itself, and no ratio means a decrease is blocked.
 */
export function parseCorporateAction(msg: string | null | undefined): CorporateAction | undefined {
  const text = msg ?? "";
  const kind = /stock_split/i.test(text)
    ? "stock_split"
    : /stock_dividend/i.test(text)
      ? "stock_dividend"
      : undefined;
  if (!kind) return undefined;
  const r = /(\d+(?:\.\d+)?)\s*(?:-?\s*for\s*-?|:)\s*(\d+(?:\.\d+)?)/i.exec(text);
  const ratio = r && Number(r[2]) > 0 ? Number(r[1]) / Number(r[2]) : undefined;
  return ratio !== undefined && ratio > 0 ? { kind, ratio } : { kind };
}

const fmt = (v: bigint) => formatUnits(v, 18, 8);
const num = (n: number) => String(Number(n.toPrecision(6)));
/** |current − old × ratio| / (old × ratio) in ppm. */
function ratioDeviationPpm(
  old: bigint,
  current: bigint,
  ratio: number,
): { expected: bigint; ppm: number } {
  const expected = (old * BigInt(Math.round(ratio * 1_000_000))) / 1_000_000n;
  const diff = current > expected ? current - expected : expected - current;
  return {
    expected,
    ppm: expected === 0n ? Number.POSITIVE_INFINITY : Number(mulDiv(diff, 1_000_000n, expected)),
  };
}

/**
 * Ondo multiplier bounds (blueprint §7.3):
 *  - never decreases, EXCEPT a matching reverse split: a `stock_split` corporate action whose ratio gives
 *    new ≈ old × ratio (within 1%). Anything else that decreases is flagged and blocked;
 *  - a single increase of up to 3% is accepted (judgement threshold; measured steps were ≤ 0.58%);
 *  - an increase above 3% needs a matching corporate action (`stock_split` / `stock_dividend`), and if the message gives a
 *    ratio the new value must also be within 1% of old × ratio.
 * There is deliberately no per-day growth cap: distributions arrive as single steps (HYG +0.40% in one day where a
 * yield ÷ 365 cap allows ~0.016%). A failing reading is flagged and blocks execution for that token.
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
  const action = parseCorporateAction(i.reasonMsg);

  if (i.current < prev) {
    const drop = `-${(Number(mulDiv(prev - i.current, 1_000_000n, prev)) / 10_000).toFixed(3)}%`;
    if (action?.kind !== "stock_split") {
      return {
        outcome: "fail",
        detail: `${base}: decreased ${drop}, no matching stock_split corporate action`,
      };
    }
    if (action.ratio === undefined) {
      return {
        outcome: "fail",
        detail: `${base}: decreased ${drop}; a stock_split is listed but its ratio can't be read, so new ≈ old × ratio can't be verified`,
      };
    }
    const { expected, ppm } = ratioDeviationPpm(prev, i.current, action.ratio);
    if (ppm <= SPLIT_MATCH_PPM) {
      return {
        outcome: "pass",
        detail: `${base}: decreased ${drop}, matching a stock_split ratio ${num(action.ratio)} (expected ${fmt(expected)}, off by ${(ppm / 10_000).toFixed(2)}%)`,
      };
    }
    return {
      outcome: "fail",
      detail: `${base}: decreased ${drop}; the listed stock_split ratio ${num(action.ratio)} expects ${fmt(expected)}, off by ${(ppm / 10_000).toFixed(2)}% (limit 1%)`,
    };
  }

  const ppm = Number(mulDiv(i.current - prev, 1_000_000n, prev));
  const pct = `+${(ppm / 10_000).toFixed(3)}%`;
  if (ppm <= JUMP_LIMIT_PPM)
    return { outcome: "pass", detail: `${base}: ${pct}, within the 3% single-step limit` };
  if (!action)
    return { outcome: "fail", detail: `${base}: ${pct}, above 3% with no corporate action` };
  if (action.ratio === undefined)
    return {
      outcome: "pass",
      detail: `${base}: ${pct}, above 3% but a ${action.kind} is listed (ratio not readable, not cross-checked)`,
    };
  const { expected, ppm: off } = ratioDeviationPpm(prev, i.current, action.ratio);
  return off <= SPLIT_MATCH_PPM
    ? {
        outcome: "pass",
        detail: `${base}: ${pct}, above 3% but matches a ${action.kind} ratio ${num(action.ratio)} (expected ${fmt(expected)})`,
      }
    : {
        outcome: "fail",
        detail: `${base}: ${pct}, the listed ${action.kind} ratio ${num(action.ratio)} expects ${fmt(expected)}, off by ${(off / 10_000).toFixed(2)}% (limit 1%)`,
      };
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
