import type { NextRequest } from "next/server";
import { z } from "zod";
import { PICKER_TICKERS } from "@/lib/tickers";
import { getEngine } from "@/lib/server/engine";
import { errorResponse, json, rateLimited, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const query = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** Set by the page right after a transaction finishes: read the chain again instead of using the short cache. */
  fresh: z.string().optional(),
});

/**
 * Tickers a wallet holds. The scan reads every registry token, so it is the costly part of this route (the provider's
 * daily quota went on it): it is kept for 45 seconds, and a page that just finished a transaction passes `fresh=1` to skip
 * the cache. Returns null when the scan fails.
 */
const HELD_TTL_MS = 45_000;
const heldCache = new Map<string, { at: number; tickers: string[] }>();
async function heldTickers(address: `0x${string}`, fresh = false): Promise<string[] | null> {
  const hit = heldCache.get(address.toLowerCase());
  if (!fresh && hit && Date.now() - hit.at < HELD_TTL_MS) return hit.tickers;
  try {
    const engine = await getEngine();
    const report = await engine.holdings(address);
    const tickers = [...new Set(report.tokens.map((t) => t.ticker.toUpperCase()))];
    heldCache.set(address.toLowerCase(), { at: Date.now(), tickers });
    return tickers;
  } catch {
    // The picker's stocks are still read; the page does not fail because the wider scan did.
    return null;
  }
}

/** A wallet's holdings in shares across issuers. Public chain data, read-only: any address works (blueprint §11). */
export async function GET(req: NextRequest) {
  if (rateLimited(req, "portfolio", 20)) return tooMany();
  try {
    const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    const engine = await getEngine();
    const t0 = Date.now();
    const held = await heldTickers(q.address as `0x${string}`, q.fresh === "1");
    const tickers = held !== null ? held : PICKER_TICKERS.map((t) => t.ticker);
    const [report, bnbUsd] = await Promise.all([
      engine.portfolio(q.address as `0x${string}`, tickers),
      engine.ports.chain.bnbUsd().catch(() => null),
    ]);
    const ms = Date.now() - t0;
    const stats = (report as { stats?: { inspected: number; cacheHits: number } }).stats;
    console.log(
      `[portfolio] tickers=${tickers.length} inspected=${stats?.inspected ?? tickers.length} hits=${stats?.cacheHits ?? 0} time=${ms}ms`,
    );
    return json({ ...report, bnbUsd });
  } catch (e) {
    return errorResponse(e);
  }
}
