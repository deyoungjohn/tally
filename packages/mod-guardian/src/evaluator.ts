import { errorMessage } from "@tally/modkit";
import {
  isFlowAggregate,
  isFlowGhostSnapshot,
  isRadarSnapshot,
  isTokenStatusState,
} from "./guards";
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
  rawFlowAggregate?: unknown;
  isFlowGhostStale?: boolean;
  isPausedOnchain?: boolean | null;
  sharePriceUsd?: number | null;
  onWarn?: (message: string) => void;
}

const RULE_SETTING_MAP: Record<string, keyof GuardianSettings["rules"]> = {
  paused: "paused",
  "share-count": "shareCount",
  "grade-drop": "gradeDrop",
  ghost: "ghost",
  "price-threshold": "priceThreshold",
  earnings: "earnings",
};

/**
 * Builds a validated TokenState from snapshot store payloads using hand-written type guards.
 * Follows the strict rule:
 * - Ghost comes from flow-ghost only when not skipped and not stale; otherwise falls back to radar.ghost.
 * - Grade and grade reasons come strictly from radar snapshot.
 * - Status.reasonMsg is never overwritten by radar reasons.
 * - Pause port is executed and stored in isPausedOnchain: boolean | null (warns on null or thrown error).
 * - Missing or invalid snapshots log an onWarn message with no silent defaults.
 */
export function buildTokenStateFromSnapshots(inputs: SnapshotStateInputs): TokenState {
  const onWarn = inputs.onWarn ?? (() => {});

  // 1. Status (left untouched)
  let status: TokenStatusState | null = null;
  if (inputs.rawStatus !== undefined && inputs.rawStatus !== null) {
    if (isTokenStatusState(inputs.rawStatus)) {
      status = inputs.rawStatus;
    } else {
      onWarn(`Status snapshot for ${inputs.ticker} (${inputs.tokenAddress}) has unexpected shape`);
    }
  }

  // 2. Grade & Radar reasons from Radar snapshot
  let grade: TokenState["grade"] = null;
  let gradeReasons: string[] = [];
  let radarGhost: boolean | null = null;

  if (inputs.rawRadar !== undefined && inputs.rawRadar !== null) {
    if (isRadarSnapshot(inputs.rawRadar)) {
      grade = inputs.rawRadar.grade;
      radarGhost = inputs.rawRadar.ghost;
      gradeReasons = inputs.rawRadar.reasons ?? [];
    } else {
      onWarn(
        `Radar snapshot for ${inputs.ticker} (${inputs.tokenAddress}) has unexpected shape; skipping radar grade`,
      );
    }
  }

  // 3. Ghost from flow-ghost, with fallback to radar
  let ghost: boolean | null = null;
  let evidenceKey: string | undefined;
  let lastRealTradeAgeDays: number | null = null;

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

  // 4. Trade age from flow-aggregate if present
  if (inputs.rawFlowAggregate !== undefined && inputs.rawFlowAggregate !== null) {
    if (isFlowAggregate(inputs.rawFlowAggregate)) {
      if (inputs.rawFlowAggregate.lastRealTradeAgeMs !== null) {
        lastRealTradeAgeDays = inputs.rawFlowAggregate.lastRealTradeAgeMs / 86_400_000;
      }
    } else {
      onWarn(`Flow-aggregate snapshot for ${inputs.ticker} has unexpected shape`);
    }
  }

  // Fallback to radar ghost if not resolved from valid, fresh flow-ghost
  if (ghost === null && radarGhost !== null) {
    ghost = radarGhost;
    evidenceKey = "radar";
  }

  // 5. bStock / Onchain pause check
  let isPausedOnchain: boolean | null = null;
  if (inputs.isPausedOnchain !== undefined) {
    isPausedOnchain = inputs.isPausedOnchain;
  } else if (inputs.issuer === "bstock") {
    onWarn(`Pause check unavailable for bStock token ${inputs.ticker} (${inputs.tokenAddress})`);
  }

  const session = inputs.session ?? status?.session ?? "unknown";

  return {
    tokenAddress: inputs.tokenAddress,
    ticker: inputs.ticker,
    issuer: inputs.issuer,
    status,
    multiplier: inputs.rawMultiplier ?? null,
    grade,
    gradeReasons,
    ghost,
    lastRealTradeAgeDays,
    sharePriceUsd: inputs.sharePriceUsd ?? null,
    session,
    observedAt: inputs.observedAt,
    isPausedOnchain,
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

  // Merge settings.priceThresholds into ports.priceThresholds with lowercased keys (ports take priority)
  const mergedPriceThresholds: Record<string, { minPriceUsd?: number; maxPriceUsd?: number }> = {};
  if (settings?.priceThresholds) {
    for (const [key, val] of Object.entries(settings.priceThresholds)) {
      mergedPriceThresholds[key.toLowerCase()] = val;
    }
  }
  if (ports?.priceThresholds) {
    for (const [key, val] of Object.entries(ports.priceThresholds)) {
      mergedPriceThresholds[key.toLowerCase()] = val;
    }
  }

  const effectivePorts: RulePorts = {
    ...ports,
    priceThresholds: mergedPriceThresholds,
    onWarn: warn,
  };

  for (const rule of rules) {
    if (rule.disabled) {
      continue;
    }

    // Check per-rule enable flag if settings are provided
    if (settings) {
      const settingKey = RULE_SETTING_MAP[rule.id];
      if (settingKey && !settings.rules[settingKey]) {
        continue;
      }
    }

    try {
      const ruleAlerts = rule.evaluate(prev, next, holding, effectivePorts);
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
