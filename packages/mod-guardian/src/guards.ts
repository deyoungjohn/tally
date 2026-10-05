import type {
  FlowAggregateSubset,
  FlowGhostSnapshotSubset,
  RadarSnapshotSubset,
  TokenStatusState,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRadarSnapshot(value: unknown): value is RadarSnapshotSubset {
  if (!isRecord(value)) return false;
  if (typeof value.ticker !== "string" || !value.ticker) return false;
  if (typeof value.address !== "string" || !value.address) return false;
  if (value.issuer !== "ondo" && value.issuer !== "bstock" && value.issuer !== "xstocks")
    return false;
  if (
    value.grade !== "A" &&
    value.grade !== "B" &&
    value.grade !== "C" &&
    value.grade !== "D" &&
    value.grade !== "F"
  )
    return false;
  if (typeof value.ghost !== "boolean") return false;
  if (
    value.reasons !== undefined &&
    (!Array.isArray(value.reasons) || !value.reasons.every((r) => typeof r === "string"))
  )
    return false;
  return true;
}

export function isFlowGhostSnapshot(value: unknown): value is FlowGhostSnapshotSubset {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (value.outcome !== "pass" && value.outcome !== "deduct" && value.outcome !== "skipped")
    return false;
  if (typeof value.points !== "number" || !Number.isFinite(value.points)) return false;
  if (value.ghost !== null && typeof value.ghost !== "boolean") return false;
  if (typeof value.reason !== "string") return false;
  return true;
}

export function isFlowAggregate(value: unknown): value is FlowAggregateSubset {
  if (!isRecord(value)) return false;
  if (typeof value.ticker !== "string") return false;
  if (value.issuer !== "ondo" && value.issuer !== "bstock" && value.issuer !== "xstocks")
    return false;
  if (typeof value.address !== "string") return false;
  if (value.lastRealTradeAt !== null && typeof value.lastRealTradeAt !== "number") return false;
  if (value.lastRealTradeAgeMs !== null && typeof value.lastRealTradeAgeMs !== "number")
    return false;
  return true;
}

export function isTokenStatusState(value: unknown): value is TokenStatusState {
  if (!isRecord(value)) return false;
  if (
    value.kind !== "open" &&
    value.kind !== "limited" &&
    value.kind !== "paused" &&
    value.kind !== "unsupported" &&
    value.kind !== "unknown"
  )
    return false;
  if (typeof value.session !== "string") return false;
  if (value.reasonCode !== null && typeof value.reasonCode !== "string") return false;
  if (value.reasonMsg !== null && typeof value.reasonMsg !== "string") return false;
  return true;
}
