import { NextResponse, type NextRequest } from "next/server";
import { verifiedWallet, rateLimitedUser } from "../../../../lib/server/session";
import { fail, rateLimited } from "../../../../lib/server/http";
import { moduleFlags } from "../../../../lib/flags";
import { openStore } from "@tally/modkit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!moduleFlags().statement) return new Response(null, { status: 404 });
  if (rateLimited(req, "active-wallet-ip", 60))
    return fail(429, "rate_limited", "Too many requests.");

  const chosen = req.headers.get("x-tally-wallet");
  const walletAddress = await verifiedWallet(req as unknown as Request, chosen);
  if (!walletAddress) return fail(401, "session_required", "Session required");

  if (rateLimitedUser(walletAddress, "active-wallet-user", 60, 60_000)) {
    return fail(429, "rate_limited", "Too many requests.");
  }

  let store;
  try {
    store = openStore();
    const now = Date.now();
    const recent = store.history("wallet:active", "bsc", 0, 50);
    const alreadyRegistered = recent.some(
      (s) =>
        s.data &&
        typeof s.data === "object" &&
        "address" in s.data &&
        s.data.address === walletAddress &&
        now - s.observedAt < 86_400_000,
    );

    if (!alreadyRegistered) {
      store.put({
        kind: "wallet:active",
        key: "bsc",
        data: { address: walletAddress },
        source: "web-session",
        observedAt: now,
      });
    }

    return new NextResponse(null, { status: 204 });
  } finally {
    store?.close();
  }
}
