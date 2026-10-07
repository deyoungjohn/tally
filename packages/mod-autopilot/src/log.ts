import type { SnapshotStore } from "@tally/modkit";
import type { DecisionRow } from "./types";

export const DECISION_LOG_KEY = "autopilot";
export interface DecisionBatch {
  rows: DecisionRow[];
}

/** Full protected history, not listLatest's bounded window. Each alert has one logical row. */
export function readDecisionLog(store: SnapshotStore): DecisionRow[] {
  const batches = store.history<DecisionBatch>(
    "decision",
    DECISION_LOG_KEY,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const rows = batches.flatMap((snapshot) => {
    if (!Array.isArray(snapshot.data.rows)) throw new Error("Invalid decision log batch");
    return snapshot.data.rows;
  });
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.alertId || ids.has(row.alertId)) throw new Error("Invalid or duplicate decided alert");
    ids.add(row.alertId);
  }
  return rows;
}

/** One atomic SnapshotStore put commits a complete run; no per-wallet partial writes. */
export function appendDecisionRows(store: SnapshotStore, rows: DecisionRow[], now: number): void {
  if (!rows.length) return;
  const ids = new Set(readDecisionLog(store).map((row) => row.alertId));
  for (const row of rows) {
    if (!row.alertId) throw new Error("Missing alert ID");
    if (ids.has(row.alertId)) throw new Error("Alert already in decision log");
    ids.add(row.alertId);
  }
  store.put<DecisionBatch>({
    kind: "decision",
    key: DECISION_LOG_KEY,
    data: { rows },
    source: "autopilot:shadow",
    observedAt: now,
  });
}
