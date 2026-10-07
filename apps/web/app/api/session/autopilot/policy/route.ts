import type { NextRequest } from "next/server";
import { moduleHealthState, openStore } from "@tally/modkit";
import {
  DAILY_CEILING,
  DEFAULT_DAILY_CAP,
  DEFAULT_PER_TRADE_CAP,
  DEFAULT_POLICY,
  PER_TRADE_CEILING,
  POLICY_MAX_AGE_MS,
  REGISTRY_MAX_AGE_MS,
  loadPositionStatus,
  registryToken,
  type PolicySettings,
  type RegistryEntry,
} from "@tally/mod-autopilot";
import { verifiedWallet, rateLimitedUser } from "../../../../../lib/server/session";
import { fail, json, rateLimited } from "../../../../../lib/server/http";
import { moduleFlags } from "../../../../../lib/flags";
import { loadAutopilot } from "../../../../../modules/autopilot/view-model";
import { policySchema } from "./schema";

export const dynamic = "force-dynamic";

async function authorize(req: NextRequest, write: boolean) {
  if (!moduleFlags().autopilot) return new Response(null, { status: 404 });
  if (rateLimited(req, `autopilot-policy-${write ? "write" : "read"}`, 60))
    return fail(429, "rate_limited", "Too many requests.");
  const wallet = await verifiedWallet(req, req.headers.get("x-tally-wallet"));
  if (!wallet) return fail(401, "session_required", "Session required");
  if (
    rateLimitedUser(
      wallet,
      `autopilot-policy-${write ? "write" : "read"}`,
      write ? 20 : 120,
      write ? 3_600_000 : 60_000,
    )
  )
    return fail(429, "rate_limited", "Too many requests.");
  return wallet.toLowerCase();
}

export async function GET(req: NextRequest) {
  const wallet = await authorize(req, false);
  if (typeof wallet !== "string") return wallet;
  let store;
  try {
    store = openStore();
    const now = Date.now();
    const snapshot = store.latest<PolicySettings>("autopilot-policy", wallet, {
      maxAgeMs: POLICY_MAX_AGE_MS,
      now,
    });
    const policy = snapshot?.data ?? DEFAULT_POLICY;
    return json({
      walletAddress: wallet,
      policy,
      policyStale: snapshot?.stale ?? false,
      ceilings: { perTradeCap: PER_TRADE_CEILING, dailyCap: DAILY_CEILING },
      defaults: {
        perTradeCap: DEFAULT_PER_TRADE_CAP,
        dailyCap: DEFAULT_DAILY_CAP,
        killSwitch: true,
      },
      ...loadPositionStatus(store, wallet, policy, now),
      viewModel: await loadAutopilot({
        walletAddress: wallet,
        verifiedSession: true,
        store,
        now,
        health: store.health.get("autopilot")
          ? moduleHealthState(store.health.get("autopilot"), now)
          : undefined,
      }),
    });
  } catch {
    console.warn("Autopilot policy read failed; details withheld");
    return fail(503, "policy_unavailable", "Autopilot policy could not be loaded.");
  } finally {
    store?.close();
  }
}

export async function PUT(req: NextRequest) {
  const wallet = await authorize(req, true);
  if (typeof wallet !== "string") return wallet;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "invalid_policy", "Expected a policy object.");
  }
  const parsed = policySchema.safeParse(body);
  if (!parsed.success)
    return fail(400, "invalid_policy", parsed.error.issues[0]?.message ?? "Invalid policy.");
  let store;
  try {
    store = openStore();
    const now = Date.now();
    const policy = parsed.data;
    if (policy.tokenAllowList.length) {
      const registry = store.latest<RegistryEntry[]>("registry", "bsc", {
        maxAgeMs: REGISTRY_MAX_AGE_MS,
        now,
      });
      if (!registry || registry.stale || !Array.isArray(registry.data))
        return fail(503, "registry_unavailable", "A current registry is required to allow tokens.");
      for (const address of policy.tokenAllowList) {
        const row = registry.data.find((r) => r.tokenContractAddress.toLowerCase() === address);
        const token = row ? registryToken(row) : null;
        if (!token) return fail(400, "token_not_allowed", "Unknown token address in registry.");
        if (!token.executable)
          return fail(400, "token_not_allowed", "Issuer not sellable: xStocks have no market.");
      }
    }
    // SnapshotStore.put inserts a row even when timestamp and key match; never overwrite history.
    store.put<PolicySettings>({
      kind: "autopilot-policy",
      key: wallet,
      data: policy,
      source: "web-session",
      observedAt: now,
    });
    return json({ walletAddress: wallet, policy });
  } catch {
    console.warn("Autopilot policy save failed; details withheld");
    return fail(503, "policy_unavailable", "Autopilot policy could not be saved.");
  } finally {
    store?.close();
  }
}
