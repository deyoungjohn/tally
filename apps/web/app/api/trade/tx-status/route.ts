import type { NextRequest } from "next/server";
import { z } from "zod";
import { getEngine } from "@/lib/server/engine";
import { errorResponse, json, rateLimited, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const query = z.object({ hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

/**
 * Onchain status of one transaction, for flows that are not buys (a sell has no ShareGuard event to decode).
 * Reads `engine.transactions.getReceipt` and returns only the status, the block, the gas used (with its dollar value) and the BscScan link:
 * no logs, no sender, no provider details.
 */
export async function GET(req: NextRequest) {
  if (rateLimited(req, "tx-status", 120)) return tooMany();
  try {
    const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    const engine = await getEngine();
    const r = await engine.transactions.getReceipt(q.hash);
    const bscscan = `https://bscscan.com/tx/${q.hash}`;
    if (!r) return json({ status: "pending", hash: q.hash, bscscan });
    // The network fee in dollars comes from the same receipt read the buy uses (gas used x effective price x BNB price).
    const gasUsd =
      (await engine.trade.receipt(q.hash as `0x${string}`).catch(() => null))?.gasUsd ?? null;
    return json({
      status: r.status,
      gasUsd,
      hash: q.hash,
      blockNumber: Number(r.blockNumber),
      gasUsed: Number(r.gasUsed),
      bscscan,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
