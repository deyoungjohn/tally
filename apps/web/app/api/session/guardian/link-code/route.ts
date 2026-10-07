import { type NextRequest } from "next/server";
import { verifiedWallet, rateLimitedUser } from "../../../../../lib/server/session";
import { fail, json, rateLimited } from "../../../../../lib/server/http";
import { moduleFlags } from "../../../../../lib/flags";
import { openStore } from "@tally/modkit";
import { loadGuardianSettings } from "../../../../../modules/guardian/view-model";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!moduleFlags().guardian) return new Response(null, { status: 404 });
  if (rateLimited(req, "guardian-link", 60)) return fail(429, "rate_limited", "Too many requests.");

  const chosen = req.headers.get("x-tally-wallet");
  const walletAddress = await verifiedWallet(req as unknown as Request, chosen);
  if (!walletAddress) return fail(401, "session_required", "Session required");

  // 5 per hour per user
  if (rateLimitedUser(walletAddress, "link-code", 5, 3_600_000)) {
    return fail(429, "rate_limited", "Too many requests.");
  }

  let store;
  try {
    store = openStore();
    const data = await loadGuardianSettings({ walletAddress, store, issueNewLinkCode: true });
    return json(data);
  } finally {
    store?.close();
  }
}
