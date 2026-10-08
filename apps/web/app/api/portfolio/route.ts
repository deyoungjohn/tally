import type { NextRequest } from "next/server";
import { z } from "zod";
import { PICKER_TICKERS } from "@/lib/tickers";
import { getEngine } from "@/lib/server/engine";
import { errorResponse, json, rateLimited, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const query = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

/** Tickers a wallet holds besides the picker's, so no held stock is left out. Cached for a few seconds: the scan reads every registry token. */
const heldCache = new Map<string, { at: number; tickers: string[] }>();
async function heldTickers(address: `0x${string}`): Promise<string[]> {
  const hit = heldCache.get(address.toLowerCase());
  if (hit && Date.now() - hit.at < 20_000) return hit.tickers;
  try {
    const engine = await getEngine();
    const report = await engine.holdings(address);
    const tickers = [...new Set(report.tokens.map((t) => t.ticker.toUpperCase()))];
    heldCache.set(address.toLowerCase(), { at: Date.now(), tickers });
    return tickers;
  } catch {
    // The picker's stocks are still read; the page does not fail because the wider scan did.
    return [];
  }
}

/** A wallet's holdings in shares across issuers. Public chain data, read-only: any address works (blueprint §11). */
export async function GET(req: NextRequest) {
  if (rateLimited(req, "portfolio", 20)) return tooMany();
  try {
    const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    const engine = await getEngine();
    const held = await heldTickers(q.address as `0x${string}`);
    const tickers = [...new Set([...PICKER_TICKERS.map((t) => t.ticker), ...held])];
    return json(await engine.portfolio(q.address as `0x${string}`, tickers));
  } catch (e) {
    return errorResponse(e);
  }
}
