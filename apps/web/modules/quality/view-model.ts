import { openStore, type SnapshotStore } from "@tally/modkit";
import {
  HINT_KIND,
  RECEIPTS_KIND,
  RECEIPT_MAX_AGE_MS,
  storedQualityReport,
  type StoredHint,
  type StoredReceipt,
  type StoredQualityReport,
} from "@tally/mod-receipts";
export interface QualityVM {
  state: "ready" | "empty" | "error" | "disabled";
  report: StoredQualityReport;
  insufficient: boolean;
  pendingCount: number;
  unverifiedPendingCount: number;
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  reason: string | null;
  error: string | null;
  truncated: boolean;
}
export type QualityViewModel = QualityVM;
export interface QualityLoadOptions {
  store?: SnapshotStore;
  now?: number;
  enabled?: boolean;
  onWarn?: (message: string) => void;
}
export async function loadQuality(options: QualityLoadOptions = {}): Promise<QualityVM> {
  const report = storedQualityReport([]);
  const vm: QualityVM = {
    state: "empty",
    report,
    insufficient: true,
    pendingCount: 0,
    unverifiedPendingCount: 0,
    stale: false,
    ageMs: null,
    source: null,
    reason: "Quality has no observations yet.",
    error: null,
    truncated: false,
  };
  if (!(options.enabled ?? process.env.FEATURE_QUALITY === "1"))
    return { ...vm, state: "disabled", reason: "Quality disabled" };
  let owned: ReturnType<typeof openStore> | undefined;
  try {
    const store = options.store ?? (owned = openStore());
    const now = options.now ?? Date.now();
    const opts = { maxAgeMs: RECEIPT_MAX_AGE_MS, now, limit: 1000 };
    const snapshots = store.listLatest<StoredReceipt>(RECEIPTS_KIND, opts),
      hints = store.listLatest<StoredHint>(HINT_KIND, opts);
    const hashes = new Set(snapshots.map((s) => s.key));
    const pendingHints = hints.filter(
      (s) => !hashes.has(s.key) && s.data.expiresAt > now && s.data.state !== "rejected",
    );
    const result = storedQualityReport(snapshots.map((s) => s.data));
    const samples = [...snapshots, ...pendingHints];
    return {
      ...vm,
      state: samples.length ? "ready" : "empty",
      report: result,
      insufficient: result.insufficient,
      pendingCount: result.pendingCount + pendingHints.length,
      unverifiedPendingCount: pendingHints.length,
      stale: samples.some((s) => s.stale),
      ageMs: samples.length ? Math.max(...samples.map((s) => s.ageMs)) : null,
      source: samples.length ? [...new Set(samples.map((s) => s.source))].join(", ") : null,
      reason: !samples.length
        ? vm.reason
        : result.n < 5
          ? "Insufficient data: fewer than 5 fills with verified comparisons. Pending attempts are excluded from statistics."
          : null,
      truncated: snapshots.length === 1000 || hints.length === 1000,
    };
  } catch {
    (options.onWarn ?? console.warn)("Quality snapshot unavailable; details withheld");
    return {
      ...vm,
      state: "error",
      error: "Snapshot store unavailable",
      reason: "Quality could not load",
    };
  } finally {
    owned?.close();
  }
}
