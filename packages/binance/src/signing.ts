import { createHmac } from "node:crypto";

export const API_PREFIX = "/build";

export interface SignInput {
  secret: string;
  /** ISO-8601 UTC with milliseconds, e.g. 2026-10-01T14:23:11.123Z. */
  timestamp: string;
  method: "GET" | "POST";
  /** Path WITHOUT the /build prefix, e.g. /api/v1/dex/aggregator/quote. */
  path: string;
  /** Already-encoded query string without the leading "?". */
  query?: string;
  /** Exact JSON body that is sent, or "". */
  body?: string;
}

/** What gets signed: timestamp + METHOD + "/build" + path + ("?" + query) + body (blueprint §7.1). Missing /build gives 40102. */
export function preHash(i: Omit<SignInput, "secret">): string {
  return (
    i.timestamp + i.method + API_PREFIX + i.path + (i.query ? `?${i.query}` : "") + (i.body ?? "")
  );
}

export function sign(i: SignInput): string {
  return createHmac("sha256", i.secret).update(preHash(i)).digest("base64");
}

export function isoTimestamp(ms: number): string {
  return new Date(ms).toISOString(); // always UTC with milliseconds
}
