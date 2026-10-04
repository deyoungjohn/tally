import { errorMessage } from "@tally/modkit";
import { isFlowGhostSnapshot, isRadarSnapshot, isTokenStatusState } from "./guards";
import type { Rule, RulePorts } from "./rules/interface";
import type {
  Alert,
  GuardianSettings,
  Issuer,
  Session,
  TokenState,
  TokenStatusState,
  UserHolding,
} from "./types";

export interface SnapshotStateInputs {
  tokenAddress: string;
  ticker: string;
  issuer: Issuer;
  observedAt: number;
  session?: Session;
  rawStatus?: unknown;
  rawMultiplier?: bigint | null;
  rawRadar?: unknown;
  rawFlowGhost?: unknown;
  isFlowGhostStale?: boolean;
  isPausedOnchain?: boolean | null;
  sharePriceUsd?: number | null;
  onWarn?: (message: string) => void;
}

/**
 * Builds a validated TokenState from snapshot store payloads using hand-written type guards.
 * Follows the strict rule:
 * - Ghost comes from flow-ghost only when not skipped and not stale; otherwise falls back to radar.ghost.
 * - Grade comes from radar snapshot.
 * - Missing or invalid snapshots log an onWarn message with no silent defaults.
 */
export function buildTokenStateFromSnapshots(inputs: SnapshotStateInputs): TokenState {
  const onWarn = inputs.onWarn ?? (() => {});

  // 1. Status
  let status: TokenStatusState | null = null;
  if (inputs.rawStatus !== undefined && inputs.rawStatus !== null) {
    if (isTokenStatusState(inputs.rawStatus)) {
      status = inputs.rawStatus;
    } else {
      onWarn(`Status snapshot for ${inputs.ticker} (${inputs.tokenAddress}) has unexpected shape`);
    }
  }

  // 2. Grade & Ghost from Radar snapshot
  let grade: TokenState["grade"] = null;
  let radarGhost: boolean | null = null;
  let radarReason: string | undefined;

  if (inputs.rawRadar !== undefined && inputs.rawRadar !== null) {
    if (isRadarSnapshot(inputs.rawRadar)) {
      grade = inputs.rawRadar.grade;
      radarGhost = inputs.rawRadar.ghost;
      radarReason = inputs.rawRadar.reasons?.[0];
    } else {
      onWarn(
        `Radar snapshot for ${inputs.ticker} (${inputs.tokenAddress}) has unexpected shape; skipping radar grade`,
      );
    }
  }

  // 3. Ghost from flow-ghost, with fallback to radar
  let ghost: boolean | null = null;
  let evidenceKey: string | undefined;

  if (inputs.rawFlowGhost !== undefined && inputs.rawFlowGhost !== null) {
    if (isFlowGhostSnapshot(inputs.rawFlowGhost)) {
      if (inputs.isFlowGhostStale) {
        onWarn(`Flow-ghost snapshot for ${inputs.ticker} is stale; falling back to radar snapshot`);
      } else if (inputs.rawFlowGhost.outcome === "skipped") {
        onWarn(
          `Flow-ghost snapshot for ${inputs.ticker} skipped (${inputs.rawFlowGhost.reason}); falling back to radar snapshot`,
        );
      } else if (inputs.rawFlowGhost.ghost !== null) {
        ghost = inputs.rawFlowGhost.ghost;
        evidenceKey = "flow-ghost";
      }
    } else {
      onWarn(
        `Flow-ghost snapshot for ${inputs.ticker} has unexpected shape; falling back to radar snapshot`,
      );
    }
  }

  // Fallback to radar ghost if not resolved from valid, fresh flow-ghost
  if (ghost === null && radarGhost !== null) {
    ghost = radarGhost;
    evidenceKey = "radar";
  }

  const session = inputs.session ?? status?.session ?? "unknown";

  return {
    tokenAddress: inputs.tokenAddress,
    ticker: inputs.ticker,
    issuer: inputs.issuer,
    status: status
      ? {
          ...status,
          reasonMsg: radarReason ?? status.reasonMsg,
        }
      : null,
    multiplier: inputs.rawMultiplier ?? null,
    grade,
    ghost,
    sharePriceUsd: inputs.sharePriceUsd ?? null,
    session,
    observedAt: inputs.observedAt,
    isPausedOnchain: inputs.isPausedOnchain,
    evidenceKey,
  };
}

/**
 * Evaluates rules for a given holding.
 * Guarantees fault isolation: if one rule throws an exception, all other rules
 * continue evaluating cleanly, and the error is reported via onWarn.
 */
export function evaluateHoldingRules(
  rules: readonly Rule[],
  prev: TokenState | null,
  next: TokenState,
  holding: UserHolding,
  ports?: RulePorts,
  settings?: GuardianSettings,
  onWarn?: (message: string) => void,
): Alert[] {
  const alerts: Alert[] = [];
  const warn = onWarn ?? ports?.onWarn ?? (() => {});

  for (const rule of rules) {
    if (rule.disabled) {
      continue;
    }

    // Check per-rule enable flag if settings are provided
    if (settings) {
      if (rule.id === "paused" && !settings.rules.paused) continue;
      if (rule.id === "share-count" && !settings.rules.shareCount) continue;
      if (rule.id === "grade-drop" && !settings.rules.gradeDrop) continue;
      if (rule.id === "ghost" && !settings.rules.ghost) continue;
      if (rule.id === "price-threshold" && !settings.rules.priceThreshold) continue;
      if (rule.id === "earnings" && !settings.rules.earnings) continue;
    }

    try {
      const ruleAlerts = rule.evaluate(prev, next, holding, ports);
      if (Array.isArray(ruleAlerts) && ruleAlerts.length > 0) {
        alerts.push(...ruleAlerts);
      }
    } catch (err) {
      const msg = `Guardian rule '${rule.id}' threw an error evaluating ${holding.ticker}: ${errorMessage(err)}`;
      warn(msg);
      // Fault isolation: do not re-throw, allow remaining rules to execute
    }
  }

  return alerts;
}
