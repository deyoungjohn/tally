import type { NextRequest } from "next/server";
import { PICKER_TICKERS } from "@/lib/tickers";
import { getEngine } from "@/lib/server/engine";
import { errorResponse, json, rateLimited, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Integrity grade of every token of the listed tickers, with plain-English reasons (blueprint §7.5). Cached 2 minutes in the engine. */
export async function GET(req: NextRequest) {
  if (rateLimited(req, "radar", 20)) return tooMany();
  try {
    const engine = await getEngine();
    return json(await engine.radar(PICKER_TICKERS.map((t) => t.ticker)));
  } catch (e) {
    return errorResponse(e);
  }
}
