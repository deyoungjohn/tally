import type { Address } from "@tally/core";
import type { Hex } from "./types";

export const HINT_KIND = "receipt-hint";
export const RECEIPTS_KIND = "receipts";
export const HINT_TTL_MS = 15 * 60_000;
export const RECEIPT_MAX_AGE_MS = 120_000;
export interface QuoteHint {
  stock: Address;
  issuer: "ondo" | "bstock";
  tokensOut: string;
  multiplier: string;
  minShares: string;
  amountInUsdt: string;
  hops: number;
  routeText: string;
  builtAt: number;
  expiresAt: number;
}
export interface ReceiptHint {
  version: 1;
  txHash: Hex;
  intentId: string;
  attempt: number;
  user: Address;
  ticker: string;
  isResumed: boolean;
  quote: QuoteHint | null;
  simulation: { available: boolean; missingReason: string | null } | null;
}
export interface StoredHint {
  hint: ReceiptHint;
  receivedAt: number;
  expiresAt: number;
  state: "pending" | "verified" | "rejected";
  reason: string;
}
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && Object.keys(v).every((k) => keys.includes(k));
const address = (v: unknown): v is Address =>
  typeof v === "string" && /^0x[\da-f]{40}$/i.test(v) && !/^0x0{40}$/i.test(v);
const uint = (v: unknown): v is string =>
  typeof v === "string" && /^(?:0|[1-9]\d{0,77})$/.test(v) && BigInt(v) < 2n ** 256n;
const time = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
/** Deliberately accepts no browser logs, realized amounts, status, gas, or arbitrary nested payload. */
export function parseReceiptHint(value: unknown): ReceiptHint | null {
  if (
    !object(value) ||
    !exact(value, [
      "version",
      "txHash",
      "intentId",
      "attempt",
      "user",
      "ticker",
      "isResumed",
      "quote",
      "simulation",
    ])
  )
    return null;
  if (
    value.version !== 1 ||
    typeof value.txHash !== "string" ||
    !/^0x[\da-f]{64}$/i.test(value.txHash) ||
    typeof value.intentId !== "string" ||
    !/^[\w:-]{1,128}$/.test(value.intentId) ||
    !time(value.attempt) ||
    value.attempt > 100 ||
    !address(value.user) ||
    typeof value.ticker !== "string" ||
    !/^[A-Z][A-Z0-9.]{0,9}$/.test(value.ticker) ||
    typeof value.isResumed !== "boolean"
  )
    return null;
  const q = value.quote;
  if (
    q !== null &&
    (!object(q) ||
      !exact(q, [
        "stock",
        "issuer",
        "tokensOut",
        "multiplier",
        "minShares",
        "amountInUsdt",
        "hops",
        "routeText",
        "builtAt",
        "expiresAt",
      ]) ||
      !address(q.stock) ||
      (q.issuer !== "ondo" && q.issuer !== "bstock") ||
      !uint(q.tokensOut) ||
      BigInt(q.tokensOut) <= 0n ||
      !uint(q.multiplier) ||
      BigInt(q.multiplier) <= 0n ||
      !uint(q.minShares) ||
      BigInt(q.minShares) <= 0n ||
      !uint(q.amountInUsdt) ||
      BigInt(q.amountInUsdt) <= 0n ||
      !time(q.hops) ||
      q.hops < 1 ||
      q.hops > 16 ||
      typeof q.routeText !== "string" ||
      q.routeText.length > 512 ||
      !time(q.builtAt) ||
      !time(q.expiresAt) ||
      q.expiresAt < q.builtAt)
  )
    return null;
  const s = value.simulation;
  if (
    s !== null &&
    (!object(s) ||
      !exact(s, ["available", "missingReason"]) ||
      typeof s.available !== "boolean" ||
      (s.available
        ? s.missingReason !== null
        : typeof s.missingReason !== "string" ||
          !s.missingReason.trim() ||
          s.missingReason.length > 512))
  )
    return null;
  return {
    ...(value as unknown as ReceiptHint),
    txHash: value.txHash.toLowerCase() as Hex,
    user: value.user.toLowerCase() as Address,
  };
}
