import type { NextRequest } from "next/server";
import { z } from "zod";
import { flags } from "@tally/config";
import { errorResponse, fail, json, rateLimited, tooMany } from "../../../../lib/server/http";
import { loadSaleProceeds } from "../../../../lib/server/sale-proceeds";

export const dynamic = "force-dynamic";

const query = z.object({
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid transaction hash"),
});

export async function GET(req: NextRequest) {
  const activeFlags = flags();
  const hashParam = req.nextUrl.searchParams.get("hash") ?? "";
  const allowed =
    activeFlags.switch ||
    (process.env.TALLY_FIXTURES === "1" && hashParam.toLowerCase().startsWith("0xf11"));
  if (!allowed) return fail(404, "not_found", "Migrate is disabled.");
  if (rateLimited(req, "sale-proceeds", 120)) return tooMany();

  try {
    const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    const result = await loadSaleProceeds(q.hash);
    return json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(e);
    }
    return fail(503, "rpc_failure", "Could not query transaction on chain. Try again.");
  }
}
