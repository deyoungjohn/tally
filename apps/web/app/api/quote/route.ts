import type { NextRequest } from "next/server";
import { z } from "zod";
import { TICKER_RE } from "@/lib/tickers";
import { toQuoteDto } from "@/lib/server/dto";
import { getEngine } from "@/lib/server/engine";
import { errorResponse, json, rateLimited, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const query = z
  .object({
    ticker: z.string().toUpperCase().regex(TICKER_RE),
    usd: z.coerce.number().positive().max(100_000).optional(),
    shares: z.coerce.number().positive().max(1_000_000).optional(),
  })
  .refine((q) => (q.usd === undefined) !== (q.shares === undefined), "give usd or shares");

/** Consolidated quote for a ticker (blueprint §7.4). Public, read-only, rate-limited, cached 10 s in the engine. */
export async function GET(req: NextRequest) {
  if (rateLimited(req, "quote", 60)) return tooMany();
  try {
    const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    const engine = await getEngine();
    const quote = await engine.quote({
      ticker: q.ticker,
      amount: q.usd !== undefined ? { usd: q.usd } : { shares: q.shares! },
    });
    return json(toQuoteDto(quote));
  } catch (e) {
    return errorResponse(e);
  }
}
