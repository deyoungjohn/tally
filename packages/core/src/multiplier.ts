import { E18, formatUnits, mulDiv } from "./units";
import type { CorporateActionKind, CorporateActionSighting, TokenStatus } from "./types";
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

/** Source of truth (blueprint §7.3): onchain for bStock and xStocks, the API for Ondo (it has no onchain multiplier). */
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

export type BoundsOutcome = "pass" | "fail" | "skipped";

/** Outcome of the independent price check (blueprint §7.3 check 3). */
export interface PriceValidation {
  /** pass/fail: the check ran. unavailable: its inputs were missing or trading has not resumed. not-needed: the multiplier did not change. */
  outcome: "pass" | "fail" | "unavailable" | "not-needed";
  /** One line with the numbers: "token $699.16 ÷ multiplier 10 = $69.92 per share vs stock $69.87: +0.06% (limit ±2%)". */
  summary: string;
  inputs: {
    tokenPrice?: number;
    multiplier?: string;
    stockPrice?: number;
    impliedSharePrice?: number;
    deviationPct?: number;
    status?: string;
  };
}

export interface OndoBoundsResult {
  outcome: BoundsOutcome;
  /** One line with the numbers: "1.0017152 vs baseline 1.0017152 (seen 2026-09-30): unchanged". */
  detail: string;
  /** The price check, always present so its inputs can be logged. */
  validation: PriceValidation;
}

/**
 * Largest single increase accepted without a corporate action. A JUDGEMENT threshold, not derived from data: the
 * largest step measured between 2026-09-30 and 2026-10-02 was +0.58% (research/ondo-multiplier-steps.md), so 3% is
 * about five times that. Revisit it when more steps have been observed.
 */
export const JUMP_LIMIT_PPM = 30_000;
/** new/old must be within 0.5% of a simple ratio to count as a split. */
export const RATIO_TOLERANCE_PPM = 5_000;
/** tokenPrice ÷ multiplier must be within 2% of the US share price. */
export const PRICE_TOLERANCE = 0.02;
/** A corporate-action status counts as "around the change" if seen within 48 h of when the multiplier changed. */
export const ACTION_WINDOW_MS = 48 * 60 * 60 * 1000;

/** The simple ratios a split can have: n and 1/n for n in 2,3,4,5,8,10,15,20,25,30,50, plus 3/2 and 2/3. */
export const SIMPLE_RATIOS: ReadonlyArray<{ label: string; ppm: bigint }> = [
  ...[2, 3, 4, 5, 8, 10, 15, 20, 25, 30, 50].flatMap((n) => [
    { label: String(n), ppm: BigInt(n) * 1_000_000n },
    { label: `1/${n}`, ppm: 1_000_000n / BigInt(n) },
  ]),
  { label: "3/2", ppm: 1_500_000n },
  { label: "2/3", ppm: 666_667n },
];

/**
 * `statusInfo.reasonMsg` carries a corporate action as a BARE CODE (`stock_split`, `stock_dividend`, …) with no ratio
 * (tokenized-securities skill docs), so a ratio is never read from it: it is inferred from the multiplier itself.
 */
export function corporateActionKind(
  msg: string | null | undefined,
): CorporateActionKind | undefined {
  const m = /\bstock_(split|dividend)\b/i.exec(msg ?? "");
  return m ? (`stock_${m[1]!.toLowerCase()}` as CorporateActionKind) : undefined;
}

/** The simple ratio closest to new/old, if one is within 0.5%. */
export function matchSimpleRatio(
  current: bigint,
  previous: bigint,
): { label: string; deviationPpm: number; quotient: number } | undefined {
  if (previous <= 0n) return undefined;
  const q = (current * 1_000_000n) / previous; // ppm
  let best: { label: string; deviationPpm: number; quotient: number } | undefined;
  for (const r of SIMPLE_RATIOS) {
    const dev = Number(mulDiv(q > r.ppm ? q - r.ppm : r.ppm - q, 1_000_000n, r.ppm));
    if (dev <= RATIO_TOLERANCE_PPM && (!best || dev < best.deviationPpm))
      best = { label: r.label, deviationPpm: dev, quotient: Number(q) / 1_000_000 };
  }
  return best;
}

const fmt = (v: bigint) => formatUnits(v, 18, 8);
const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * Independent price check (blueprint §7.3 check 3): once trading has resumed, tokenPrice ÷ newMultiplier must be within
 * 2% of the US share price (`stockInfo.price`). It does not use any multiplier source, so it validates them all.
 */
export function validateMultiplierAgainstPrice(i: {
  multiplier: bigint;
  tokenPrice?: number;
  stockPrice?: number;
  status: TokenStatus | null;
}): PriceValidation {
  const mult = fmt(i.multiplier);
  const inputs: PriceValidation["inputs"] = {
    tokenPrice: i.tokenPrice,
    multiplier: mult,
    stockPrice: i.stockPrice,
    status: i.status?.kind,
  };
  const resumed = i.status !== null && (i.status.kind === "open" || i.status.kind === "limited");
  if (!resumed) {
    return {
      outcome: "unavailable",
      inputs,
      summary: `trading has not resumed (status ${i.status ? `${i.status.kind}${i.status.reasonCode ? ` ${i.status.reasonCode}` : ""}` : "unknown"}), price check waits`,
    };
  }
  if (!i.tokenPrice || !i.stockPrice || i.tokenPrice <= 0 || i.stockPrice <= 0) {
    return {
      outcome: "unavailable",
      inputs,
      summary: `price check inputs missing (token price ${i.tokenPrice ?? "none"}, stock price ${i.stockPrice ?? "none"})`,
    };
  }
  const implied = i.tokenPrice / Number(formatUnits(i.multiplier, 18));
  const dev = implied / i.stockPrice - 1;
  inputs.impliedSharePrice = implied;
  inputs.deviationPct = Number((dev * 100).toFixed(3));
  const line = `token ${usd(i.tokenPrice)} ÷ multiplier ${mult} = ${usd(implied)} per share vs stock ${usd(i.stockPrice)}: ${dev >= 0 ? "+" : ""}${(dev * 100).toFixed(2)}% (limit ±${PRICE_TOLERANCE * 100}%)`;
  return { outcome: Math.abs(dev) <= PRICE_TOLERANCE ? "pass" : "fail", inputs, summary: line };
}

export interface OndoBoundsInput {
  current: bigint;
  /** Last accepted reading (the baseline). Without one only a sanity check is possible. */
  previous?: { value: bigint; at: number };
  now: number;
  /** Current status: "trading has resumed" is judged from it. */
  status: TokenStatus | null;
  /** When a corporate-action status was seen (including right now). */
  action?: CorporateActionSighting;
  /** When the multiplier changed (Binance's `lastUpdateTime`); defaults to `now`. */
  changedAt?: number;
  /** Token and stock price for the price check. */
  prices?: { tokenPrice?: number; stockPrice?: number };
}

/**
 * Ondo multiplier bounds (blueprint §7.3). Every CHANGE is also checked against the market (check 3, independent of any
 * multiplier source).
 *  - a single increase of up to 3% (judgement threshold; measured steps were ≤ 0.58%) is accepted, provided the price
 *    check does not FAIL (it may be unavailable, e.g. trading not open: then the step is accepted on size alone);
 *  - a decrease, or an increase above 3%, is accepted automatically only when ALL THREE hold:
 *      (1) the status showed `stock_split` / `stock_dividend` within 48 h of the change;
 *      (2) new/old is within 0.5% of a simple ratio (n or 1/n for n in 2,3,4,5,8,10,15,20,25,30,50, plus 3/2 and 2/3);
 *      (3) trading has resumed and tokenPrice ÷ newMultiplier is within 2% of the US share price.
 *    Until then the token stays blocked and flagged; an owner's manual action is only a fallback.
 * There is deliberately no per-day growth cap: distributions arrive as single steps (HYG +0.40% in one day where a
 * yield ÷ 365 cap allows ~0.016%).
 */
export function checkOndoMultiplier(i: OndoBoundsInput): OndoBoundsResult {
  const skippedValidation: PriceValidation = {
    outcome: "not-needed",
    inputs: {},
    summary: "multiplier unchanged: price check not needed",
  };
  if (i.current <= 0n)
    return {
      outcome: "fail",
      detail: `multiplier ${i.current} is zero or negative`,
      validation: skippedValidation,
    };
  if (!i.previous) {
    return {
      outcome: "skipped",
      detail: `${fmt(i.current)}: no baseline for this token, only checked for sanity`,
      validation: { ...skippedValidation, summary: "no baseline: price check not run" },
    };
  }
  const prev = i.previous.value;
  const base = `${fmt(i.current)} vs baseline ${fmt(prev)} (seen ${new Date(i.previous.at).toISOString().slice(0, 10)})`;
  if (i.current === prev)
    return { outcome: "pass", detail: `${base}: unchanged`, validation: skippedValidation };

  const validation = validateMultiplierAgainstPrice({
    multiplier: i.current,
    tokenPrice: i.prices?.tokenPrice,
    stockPrice: i.prices?.stockPrice,
    status: i.status,
  });
  const priceText = `price check: ${validation.summary}`;
  const increase = i.current > prev;
  const ppm = Number(mulDiv(increase ? i.current - prev : prev - i.current, 1_000_000n, prev));
  const move = `${increase ? "+" : "-"}${(ppm / 10_000).toFixed(3)}%`;

  if (increase && ppm <= JUMP_LIMIT_PPM) {
    return validation.outcome === "fail"
      ? {
          outcome: "fail",
          detail: `${base}: ${move}, within the 3% step limit but it FAILED the price check (${priceText})`,
          validation,
        }
      : {
          outcome: "pass",
          detail: `${base}: ${move}, within the 3% single-step limit; ${priceText}`,
          validation,
        };
  }

  const changedAt = i.changedAt ?? i.now;
  const c1 =
    !!i.action &&
    i.action.firstSeenAt <= changedAt + ACTION_WINDOW_MS &&
    i.action.lastSeenAt >= changedAt - ACTION_WINDOW_MS;
  const ratio = matchSimpleRatio(i.current, prev);
  const c3 = validation.outcome === "pass";
  const t1 = c1
    ? `(1) ${i.action!.kind} seen ${new Date(i.action!.firstSeenAt).toISOString().slice(0, 16)}Z–${new Date(i.action!.lastSeenAt).toISOString().slice(0, 16)}Z, within 48h of the change at ${new Date(changedAt).toISOString().slice(0, 16)}Z`
    : `(1) no stock_split/stock_dividend status seen within 48h of the change at ${new Date(changedAt).toISOString().slice(0, 16)}Z${i.action ? ` (last ${i.action.kind} seen ${new Date(i.action.lastSeenAt).toISOString().slice(0, 16)}Z)` : ""}`;
  const t2 = ratio
    ? `(2) new/old = ${Number(ratio.quotient.toPrecision(6))}, simple ratio ${ratio.label} (off ${(ratio.deviationPpm / 10_000).toFixed(2)}%)`
    : `(2) new/old = ${(Number(mulDiv(i.current, 1_000_000n, prev)) / 1_000_000).toPrecision(4)}, no simple ratio within 0.5%`;
  const t3 = `(3) ${priceText}`;
  const kind = increase ? "increase above 3%" : "decrease";
  if (c1 && ratio && c3)
    return {
      outcome: "pass",
      detail: `${base}: ${move} ${kind}, accepted, all three hold: ${t1}; ${t2}; ${t3}`,
      validation,
    };
  return {
    outcome: "fail",
    detail: `${base}: ${move} ${kind}, blocked until all three hold: ${t1}; ${t2}; ${t3}`,
    validation,
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
