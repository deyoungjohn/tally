import type { SnapshotStore } from "@tally/modkit";
import { decide, POSITION_MAX_AGE_MS, spentToday } from "./decide";
import { appendDecisionRows, readDecisionLog } from "./log";
import type { Alert, DecisionRow, Policy, PolicySettings, Position } from "./types";

export const DEFAULT_POLICY: PolicySettings = {
  armedRules: {},
  tokenAllowList: [],
  killSwitch: true,
};
export const POLICY_MAX_AGE_MS = 86_400_000;
export const positionKey = (wallet: string, token: string) =>
  `${wallet.toLowerCase()}:${token.toLowerCase()}`;

export interface ShadowContext {
  store: SnapshotStore;
  now: () => number;
  onWarn: (message: string) => void;
  signal?: AbortSignal;
  isRegularSession?: Policy["isRegularSession"];
}

/** Snapshot-only adapter. No engine methods, network, subprocess or execution capability. */
export function runShadow(ctx: ShadowContext): number {
  try {
    ctx.signal?.throwIfAborted();
    const now = ctx.now();
    const existing = readDecisionLog(ctx.store);
    const seen = new Set(existing.map((row) => row.alertId));
    const feeds = ctx.store.listLatest<Alert[]>("alerts", { maxAgeMs: 60_000, now, limit: 1000 });
    // Avoid silently ignoring wallets at the store's listLatest capacity boundary.
    if (feeds.length === 1000) throw new Error("Alert feed capacity reached");
    const pending: DecisionRow[] = [];
    for (const feed of feeds) {
      if (!Array.isArray(feed.data)) throw new Error("Invalid alerts snapshot");
      for (const alert of feed.data) {
        ctx.signal?.throwIfAborted();
        if (alert.walletAddress.toLowerCase() !== feed.key.toLowerCase())
          throw new Error("Alert wallet does not match feed");
        if (seen.has(alert.id)) continue;
        const settings = ctx.store.latest<PolicySettings>(
          "autopilot-policy",
          feed.key.toLowerCase(),
          {
            maxAgeMs: POLICY_MAX_AGE_MS,
            now,
          },
        );
        const position = ctx.store.latest<Position>(
          "autopilot-position",
          positionKey(alert.walletAddress, alert.evidence.snapshotKey),
          { maxAgeMs: POSITION_MAX_AGE_MS, now },
        );
        const policy: Policy = { ...(settings?.data ?? DEFAULT_POLICY) };
        if (!settings || settings.stale) {
          ctx.onWarn("Autopilot policy missing or stale; rules are unarmed");
          policy.armedRules = {};
        }
        const regularSession =
          alert.rule === "price-threshold" ? (ctx.isRegularSession?.(now) ?? null) : null;
        policy.isRegularSession = () => regularSession;
        const state = { position: position?.data ?? null, rows: existing };
        const result = decide(alert, policy, state, now);
        if (feed.stale && !result.reasons.includes("alert stale")) {
          result.decision = "alertOnly";
          result.reasons.push("alert stale");
          delete result.leg;
        }
        if (position?.stale && !result.reasons.includes("position stale")) {
          result.decision = "alertOnly";
          result.reasons.push("position stale");
          delete result.leg;
        }
        for (const reason of result.reasons) ctx.onWarn(`Autopilot alert only: ${reason}`);
        const { isRegularSession: _session, ...recordedPolicy } = policy;
        void _session;
        pending.push({
          ...result,
          alertId: alert.id,
          walletAddress: alert.walletAddress.toLowerCase(),
          rule: alert.rule,
          decidedAt: now,
          mode: "shadow",
          inputs: {
            alert,
            policy: recordedPolicy,
            position: state.position,
            spentToday: spentToday(existing, alert.walletAddress, now),
            regularSession,
          },
        });
        seen.add(alert.id);
      }
    }
    ctx.signal?.throwIfAborted();
    appendDecisionRows(ctx.store, pending, now);
    return pending.length;
  } catch (error) {
    ctx.onWarn("Autopilot shadow evaluation failed; decision log unchanged");
    throw error;
  }
}
