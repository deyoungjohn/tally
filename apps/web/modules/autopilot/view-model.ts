import { formatUnits, type Issuer } from "@tally/core";
import {
  DAILY_CEILING,
  DEFAULT_POLICY,
  effectiveCaps,
  PER_TRADE_CEILING,
  POLICY_MAX_AGE_MS,
  readDecisionLog,
  spentToday,
  type PolicySettings,
} from "@tally/mod-autopilot";
import type { ModuleHealthState, SnapshotStore } from "@tally/modkit";

export const BACKSTOP_BANNER =
  "Binance's own daily limit is $1,000 and is only a backstop; these caps are enforced by Tally.";
export const SHADOW_LABEL = "would have sold; nothing was executed";
export interface DecisionRowVM {
  alertId: string;
  rule: string;
  ticker: string;
  issuer: Issuer;
  decidedAt: number;
  decision: "execute" | "alertOnly";
  reasons: string[];
  mode: "shadow" | "live";
  label: string;
  tokens: string | null;
  usdCap: string | null;
  receiptId: string | null;
}
export interface AutopilotVM {
  state: "ready" | "empty" | "stale" | "error";
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  reason: string | null;
  error: string | null;
  walletAddress: string | null;
  banner: typeof BACKSTOP_BANNER;
  walletLimit: string;
  mode: "shadow";
  armedRules: PolicySettings["armedRules"];
  tokenAllowList: readonly string[];
  caps: { perTrade: string; daily: string; perTradeCeiling: string; dailyCeiling: string };
  spentToday: string;
  killSwitch: boolean;
  rows: DecisionRowVM[];
}
export type AutopilotViewModel = AutopilotVM;

export interface AutopilotLoadOptions {
  /** Must be supplied by a verified wallet session in production. */
  walletAddress?: string;
  store?: SnapshotStore;
  now?: number;
  health?: ModuleHealthState;
  onWarn?: (message: string) => void;
}

export async function loadAutopilot(opts: AutopilotLoadOptions = {}): Promise<AutopilotVM> {
  const wallet = opts.walletAddress?.toLowerCase() ?? null;
  const now = opts.now ?? Date.now();
  const defaults = effectiveCaps(DEFAULT_POLICY);
  const vm: AutopilotVM = {
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: wallet
      ? "Autopilot has no observations yet."
      : "Connect your wallet to view Autopilot.",
    error: null,
    walletAddress: wallet,
    banner: BACKSTOP_BANNER,
    walletLimit:
      "Autopilot works for the chief engineer's own Agentic Wallet only; other users need their own Agentic Wallet.",
    mode: "shadow",
    armedRules: {},
    tokenAllowList: [],
    caps: {
      perTrade: formatUnits(defaults.perTrade, 18),
      daily: formatUnits(defaults.daily, 18),
      perTradeCeiling: formatUnits(PER_TRADE_CEILING, 18),
      dailyCeiling: formatUnits(DAILY_CEILING, 18),
    },
    spentToday: "0",
    killSwitch: false,
    rows: [],
  };
  if (!wallet || !opts.store) return vm;
  try {
    const policySnap = opts.store.latest<PolicySettings>("autopilot-policy", wallet, {
      maxAgeMs: POLICY_MAX_AGE_MS,
      now,
    });
    const rows = readDecisionLog(opts.store).filter(
      (row) => row.walletAddress.toLowerCase() === wallet,
    );
    const policy = policySnap?.data ?? DEFAULT_POLICY;
    const caps = effectiveCaps(policy);
    vm.armedRules = policy.armedRules;
    vm.tokenAllowList = policy.tokenAllowList;
    vm.killSwitch = policy.killSwitch;
    vm.caps.perTrade = formatUnits(caps.perTrade, 18);
    vm.caps.daily = formatUnits(caps.daily, 18);
    vm.spentToday = formatUnits(spentToday(rows, wallet, now), 18);
    vm.rows = rows
      .map((row) => ({
        alertId: row.alertId,
        rule: row.rule,
        ticker: row.inputs.alert.ticker,
        issuer: row.inputs.alert.issuer,
        decidedAt: row.decidedAt,
        decision: row.decision,
        reasons: row.reasons,
        mode: row.mode,
        label:
          row.mode === "shadow" && row.decision === "execute"
            ? SHADOW_LABEL
            : row.decision === "alertOnly"
              ? row.mode === "shadow"
                ? "shadow alert only; nothing was executed"
                : "alert only"
              : row.receiptId
                ? "executed sale"
                : "execution not verified",
        tokens: row.leg ? formatUnits(row.leg.tokens, row.inputs.position!.tokenDecimals) : null,
        usdCap: row.leg ? formatUnits(row.leg.usdCap, 18) : null,
        receiptId: row.receiptId ?? null,
      }))
      .sort((a, b) => b.decidedAt - a.decidedAt);
    // Freshness comes from worker health when available. Quiet logs need not change each run.
    const logAgeMs = rows.length
      ? Math.max(0, now - rows.reduce((latest, row) => Math.max(latest, row.decidedAt), 0))
      : null;
    vm.ageMs = opts.health ? opts.health.ageMs : (logAgeMs ?? policySnap?.ageMs ?? null);
    vm.source = rows.length ? "autopilot:shadow" : (policySnap?.source ?? null);
    vm.stale = Boolean(
      opts.health?.stale ||
      (!opts.health && logAgeMs !== null && logAgeMs > 180_000) ||
      policySnap?.stale,
    );
    if (!rows.length && !policySnap) return vm;
    vm.state = vm.stale ? "stale" : "ready";
    vm.reason = vm.stale
      ? "Autopilot observations are stale; shown with their age."
      : opts.health?.degraded
        ? opts.health.reason
        : null;
    if (opts.health?.degraded && !opts.health.stale) {
      vm.state = "error";
      vm.error = opts.health.reason;
    }
    return vm;
  } catch {
    (opts.onWarn ?? console.warn)("Autopilot view model failed; showing an error state");
    return {
      ...vm,
      state: "error",
      reason: "Autopilot observations could not be loaded.",
      error: "Autopilot observations could not be loaded.",
    };
  }
}
