import { type NextRequest } from "next/server";
import { verifiedWallet } from "../../../../../lib/server/session";
import { fail, json, rateLimited } from "../../../../../lib/server/http";
import { moduleFlags } from "../../../../../lib/flags";
import { openStore } from "@tally/modkit";
import { loadAlertFeed } from "../../../../../modules/guardian/view-model";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!moduleFlags().guardian) return new Response(null, { status: 404 });
  if (rateLimited(req, "guardian-feed", 60)) return fail(429, "rate_limited", "Too many requests.");

  const chosen = req.headers.get("x-tally-wallet");
  const walletAddress = await verifiedWallet(req as unknown as Request, chosen);
  if (!walletAddress) return fail(401, "session_required", "Session required");

  let store;
  try {
    store = openStore();
    const data = await loadAlertFeed({ walletAddress, store });
    const { moduleHealthState } = await import("@tally/modkit");
    const health = moduleHealthState(store.health.get("guardian"));
    data.moduleDegraded = health.degraded;
    data.moduleReason = health.reason;
    return json(data);
  } finally {
    store?.close();
  }
}
