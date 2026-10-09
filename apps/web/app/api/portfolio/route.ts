import type { NextRequest } from "next/server";
import { z } from "zod";
import { PICKER_TICKERS } from "@/lib/tickers";
import { getEngine } from "@/lib/server/engine";
import { errorResponse, json, rateLimited, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const query = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

/** Tickers a wallet holds. Cached for two seconds: the scan reads every registry token. Returns null when scan fails. */
const heldCache = new Map<string, { at: number; tickers: string[] }>();
async function heldTickers(address: `0x${string}`): Promise<string[] | null> {
  const hit = heldCache.get(address.toLowerCase());
  if (hit && Date.now() - hit.at < 2_000) return hit.tickers;
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
    const held = await heldTickers(q.address as `0x${string}`);
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
