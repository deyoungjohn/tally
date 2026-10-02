import type { NextRequest } from "next/server";
import { z } from "zod";
import { PICKER_TICKERS } from "@/lib/tickers";
import { getEngine } from "@/lib/server/engine";
import { errorResponse, json, rateLimited, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const query = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

/** A wallet's holdings in shares across issuers. Public chain data, read-only: any address works (blueprint §11). */
export async function GET(req: NextRequest) {
  if (rateLimited(req, "portfolio", 20)) return tooMany();
  try {
    const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    const engine = await getEngine();
    return json(
      await engine.portfolio(
        q.address as `0x${string}`,
        PICKER_TICKERS.map((t) => t.ticker),
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
