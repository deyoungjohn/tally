import { type NextRequest } from "next/server";
import { verifiedWallet, rateLimitedUser } from "../../../../../lib/server/session";
import { fail, json, rateLimited } from "../../../../../lib/server/http";
import { moduleFlags } from "../../../../../lib/flags";
import { openStore, moduleHealthState } from "@tally/modkit";
import { loadGuardianSettings } from "../../../../../modules/guardian/view-model";
import { createGuardianSettingsSchema, saveGuardianSettings } from "@tally/mod-guardian";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!moduleFlags().guardian) return new Response(null, { status: 404 });
  if (rateLimited(req, "guardian-settings", 60))
    return fail(429, "rate_limited", "Too many requests.");

  const chosen = req.headers.get("x-tally-wallet");
  const walletAddress = await verifiedWallet(req as unknown as Request, chosen);
  if (!walletAddress) return fail(401, "session_required", "Session required");

  let store;
  try {
    store = openStore();
    const data = await loadGuardianSettings({ walletAddress, store });
    const health = moduleHealthState(store.health.get("guardian") ?? null);
    data.moduleDegraded = health.degraded;
    data.moduleReason = health.reason;
    return json(data);
  } finally {
    store?.close();
  }
}

export async function PUT(req: NextRequest) {
  if (!moduleFlags().guardian) return new Response(null, { status: 404 });
  const chosen = req.headers.get("x-tally-wallet");
  const walletAddress = await verifiedWallet(req as unknown as Request, chosen);
  if (!walletAddress) return fail(401, "session_required", "Session required");

  if (
    rateLimited(req, "guardian-settings-put", 30, 3_600_000) ||
    rateLimitedUser(walletAddress, "guardian-settings-put", 30, 3_600_000)
  ) {
    return fail(429, "rate_limited", "Too many requests.");
  }

  let store;
  try {
    store = openStore();
    const registrySnap = store.latest<{ ticker?: string; underlyingTicker?: string }[]>(
      "registry",
      "bsc",
      {
        maxAgeMs: Infinity,
      },
    );
    if (!registrySnap) {
      return fail(503, "not_ready", "ticker list not loaded yet");
    }
    const validTickers = new Set(
      registrySnap.data
        .map((r) => r.underlyingTicker || r.ticker)
        .filter(Boolean)
        .map((t) => String(t).toUpperCase()),
    );

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail(400, "invalid_body", "Invalid JSON body");
    }

    const schema = createGuardianSettingsSchema(validTickers);
    const result = schema.safeParse(body);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(", ");
      return fail(400, "invalid_input", messages);
    }

    saveGuardianSettings(store, walletAddress, result.data);

    const data = await loadGuardianSettings({ walletAddress, store });
    const health = moduleHealthState(store.health.get("guardian") ?? null);
    data.moduleDegraded = health.degraded;
    data.moduleReason = health.reason;
    return json(data);
  } finally {
    store?.close();
  }
}
