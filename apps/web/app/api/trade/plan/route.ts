import type { NextRequest } from "next/server";
import { z } from "zod";
import { isBuyable, TICKER_RE } from "@/lib/tickers";
import { getEngine } from "@/lib/server/engine";
import { errorResponse, fail, json, rateLimited, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const body = z.object({
  ticker: z.string().toUpperCase().regex(TICKER_RE),
  issuer: z.enum(["ondo", "bstock"]),
  usd: z.number().positive().max(10_000),
  tolerancePct: z.number().min(0.1).max(5).optional(),
  user: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

/**
 * Trade plan (blueprint §7.6). Always re-quotes. Returns one of: needs_funds, needs_approval (exact amount), or ready
 * (calldata, gas limit = estimate × 1.25, simulated at that limit). Call again when `expiresAt` passes or after the approval mines.
 */
export async function POST(req: NextRequest) {
  if (rateLimited(req, "plan", 30)) return tooMany();
  try {
    const b = body.parse(await req.json());
    if (!isBuyable(b.ticker))
      return fail(409, "not_buyable", `${b.ticker} can't be bought through Tally yet.`);
    const engine = await getEngine();
    const plan = await engine.trade.prepare({
      ticker: b.ticker,
      issuer: b.issuer,
      usd: b.usd,
      tolerancePct: b.tolerancePct,
      user: b.user as `0x${string}`,
    });
    return json(plan);
  } catch (e) {
    return errorResponse(e);
  }
}
