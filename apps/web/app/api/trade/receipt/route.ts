import type { NextRequest } from "next/server";
import { z } from "zod";
import { TICKER_RE } from "@/lib/tickers";
import { getEngine } from "@/lib/server/engine";
import { errorResponse, json, rateLimited, tooMany } from "@/lib/server/http";
import { appendJsonl, readJsonl } from "@/lib/server/store";
import type { FillDto } from "@/lib/dto";

export const dynamic = "force-dynamic";

const query = z.object({
  tx: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  ticker: z.string().toUpperCase().regex(TICKER_RE).optional(),
  symbol: z.string().max(12).optional(),
});

/** Receipt in shares: decodes the guard's `Guarded` event. The first successful read stores the fill (once per tx). */
export async function GET(req: NextRequest) {
  if (rateLimited(req, "receipt", 120)) return tooMany();
  try {
    const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    const engine = await getEngine();
    const r = await engine.trade.receipt(q.tx as `0x${string}`, q.ticker);
    if (r.status === "success" && r.fill) {
      const known = await readJsonl<FillDto>("fills.jsonl", 200);
      if (!known.some((f) => f.txHash === r.txHash)) {
        await appendJsonl("fills.jsonl", {
          txHash: r.txHash,
          at: Date.now(),
          ticker: q.ticker ?? "",
          symbol: q.symbol ?? "",
          shares: Number(r.fill.shares) / 1e18,
          premium: r.fill.premium,
          usdPerShare: r.fill.usdPerShare,
        } satisfies FillDto);
      }
    }
    return json(r);
  } catch (e) {
    return errorResponse(e);
  }
}
