import type { NextRequest } from "next/server";
import { z } from "zod";
import { isBuyable, TICKER_RE } from "../../../../lib/tickers";
import { getEngine } from "../../../../lib/server/engine";
import { errorResponse, fail, json, rateLimited, tooMany } from "../../../../lib/server/http";

export const dynamic = "force-dynamic";

const body = z
  .object({
    ticker: z.string().toUpperCase().regex(TICKER_RE),
    issuer: z.enum(["ondo", "bstock", "xstocks"]),
    usd: z.number().positive().max(10_000).optional(),
    shares: z.number().positive().max(10_000).optional(),
    tokens: z.string().regex(/^\d+$/).optional(),
    tolerancePct: z.number().min(0.1).max(5).optional(),
    user: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  })
  .refine(
    (data) => data.usd !== undefined || data.shares !== undefined || data.tokens !== undefined,
    { message: "Specify usd, shares, or tokens to sell." },
  );

/**
 * Sell plan: converts tokenized stock directly into USDT via Binance Web3 Aggregator swap calldata
 * signed directly by the user's wallet. Always re-quotes. Call again when `expiresAt` passes or after approval mines.
 */
export async function POST(req: NextRequest) {
  if (rateLimited(req, "sell", 30)) return tooMany();
  try {
    const b = body.parse(await req.json());
    if (!isBuyable(b.ticker))
      return fail(409, "not_buyable", `${b.ticker} can't be traded through Tally yet.`);
    const engine = await getEngine();
    const plan = await engine.trade.prepareSell({
      ticker: b.ticker,
      issuer: b.issuer,
      usd: b.usd,
      shares: b.shares,
      tokens: b.tokens,
      tolerancePct: b.tolerancePct,
      user: b.user as `0x${string}`,
    });
    return json(plan);
  } catch (e) {
    return errorResponse(e);
  }
}
