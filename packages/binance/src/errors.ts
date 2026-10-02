import type { EngineErrorKind, KindedError } from "@tally/core";

/**
 * Observed and documented response codes (blueprint §7.1, docs llms-full.txt 2026-10-02, fixtures in fixtures/raw).
 * The docs list 40301/40302/40303 for region problems but not 40304, which is what US, NL and RO callers actually get.
 */
const KIND_BY_CODE: Record<number, EngineErrorKind> = {
  40001: "param",
  40101: "auth",
  40102: "auth",
  40103: "auth", // timestamp outside recv window: check the server clock
  40104: "auth",
  40301: "region_block",
  40302: "region_block", // proxy or VPN detected
  40303: "region_block",
  40304: "region_block", // observed: "Service not available due to compliance restriction", sent as HTTP 200
  40311: "compliance",
  40312: "compliance",
  40313: "compliance",
  40314: "compliance",
  40434: "compliance",
  40367: "token_unavailable", // Ondo outside US market hours
  40369: "token_unavailable", // bStock market-hours restriction
  40375: "below_minimum", // "Minimum order amount is 5 USD."
  40401: "quote_expired",
  40462: "quote_expired",
  42900: "rate_limited",
  50000: "upstream",
  50001: "upstream",
};

export class BinanceApiError extends Error implements KindedError {
  override readonly name = "BinanceApiError";
  constructor(
    readonly kind: EngineErrorKind,
    readonly code: number | string | undefined,
    message: string,
    readonly http: number | undefined,
    readonly path: string,
  ) {
    super(message);
  }
}

export function kindForCode(code: number): EngineErrorKind {
  return KIND_BY_CODE[code] ?? (code >= 50000 ? "upstream" : "unknown");
}

export function isSuccessCode(code: unknown): boolean {
  return code === 0 || code === "0" || code === "000000";
}

export const NON_RETRYABLE_KINDS: ReadonlySet<EngineErrorKind> = new Set([
  "region_block",
  "compliance",
  "auth",
  "param",
  "below_minimum",
  "token_unavailable",
  "quote_expired",
]);
