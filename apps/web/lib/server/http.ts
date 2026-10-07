import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import type { ApiError } from "@/lib/dto";

/** JSON with bigint-safe output. */
export function json(data: unknown, status = 200): NextResponse {
  return new NextResponse(
    JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    { status, headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}

export function fail(status: number, kind: string, message: string): NextResponse {
  const body: ApiError = { error: { kind, message } };
  return json(body, status);
}

interface Kinded {
  kind?: string;
  message?: string;
  code?: number | string;
}

/** Errors to plain-English responses (blueprint §7.1 and §7.6 error tables). Never leaks internals. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ZodError) return fail(400, "invalid_request", "That request wasn't valid.");
  const k = e as Kinded;
  switch (k.kind) {
    case "below_minimum":
      return fail(400, "below_minimum", "Minimum is $6.");
    case "param":
      return fail(404, "unknown_ticker", "We don't list that stock.");
    case "region_block":
      // Region drift is an ops incident (blueprint §7.1): page ops, show nothing alarming to the user.
      console.error("ALERT region_block (40304): the server's region is refused by Binance");
      return fail(503, "quotes_unavailable", "Quotes are temporarily unavailable.");
    case "rate_limited":
      return fail(503, "busy", "Busy right now. Try again in a few seconds.");
    case "auth":
      console.error("ALERT binance auth error", k.code);
      return fail(503, "quotes_unavailable", "Quotes are temporarily unavailable.");
    case "network":
    case "upstream":
      return fail(502, "upstream", "We couldn't reach the price source. Try again.");
  }
  if (isTradeError(e)) {
    // The person sees the plain message; the log keeps the underlying reason (an RPC error, a revert) so a repeat can be diagnosed.
    const detail = (e as { detail?: string }).detail;
    console.warn(
      `trade error ${e.kind}: ${e.message}${detail ? ` | ${detail.slice(0, 300)}` : ""}`,
    );
    return fail(409, e.kind, e.message);
  }
  console.error("unhandled:", e instanceof Error ? e.message.slice(0, 200) : e);
  return fail(500, "internal", "Something went wrong on our side. Nothing was spent.");
}

// Kinds thrown by the trade plan (packages/engine/src/trade.ts). Matched by kind, not class, because bundling renames classes.
const TRADE_KINDS = new Set([
  "invalid_request",
  "not_buyable",
  "token_paused",
  "guard_paused",
  "rfq_required",
  "router_not_allowed",
  "feed_stale",
  "feed_blocked",
  "price_moved",
  "route_failed",
  "gas_estimate_failed",
  "simulation_reverted",
  "expired",
]);
function isTradeError(e: unknown): e is { kind: string; message: string; detail?: string } {
  return e instanceof Error && TRADE_KINDS.has((e as Kinded).kind ?? "");
}

/** Per-IP sliding-window limiter (blueprint §11). In memory: one process on one box. */
const hits = new Map<string, number[]>();
export function clientIp(req: NextRequest): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}
export function rateLimited(req: NextRequest, bucket: string, max: number, windowMs = 60_000) {
  const key = `${bucket}:${clientIp(req)}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5_000)
    for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return recent.length > max * (Number(process.env.TALLY_RATE_LIMIT_MULT) || 1);
}
export const tooMany = () => fail(429, "rate_limited", "Too many requests. Slow down a little.");
