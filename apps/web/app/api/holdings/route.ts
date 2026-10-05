import type { NextRequest } from "next/server";
import { z } from "zod";
import { getEngine } from "@/lib/server/engine";
import { errorResponse, json, rateLimited, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const query = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

/** Every tokenized stock token the wallet holds, for the Send form. Public chain data, read-only. */
export async function GET(req: NextRequest) {
  if (rateLimited(req, "holdings", 20)) return tooMany();
  try {
    const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    const engine = await getEngine();
    return json(await engine.holdings(q.address as `0x${string}`));
  } catch (e) {
    return errorResponse(e);
  }
}
