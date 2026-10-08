import type { WorkerJob } from "../runner";

const HOUR = 60 * 60 * 1000;
export const SNAPSHOT_RETENTION_MS = {
  price: 24 * HOUR,
  prices: 2 * HOUR,
  registry: 6 * HOUR,
  flow: HOUR / 2,
  "flow-traders": HOUR / 2,
  "flow-holders": HOUR / 2,
  "flow-pools": HOUR / 2,
  "flow-aggregate": 24 * HOUR,
  default: 7 * 24 * HOUR,
} as const;

// An explicit allowlist protects every guardian-* kind, including future ones, without
// changing the shared store API. Other known non-evidence kinds keep their seven days.
const DEFAULT_RETENTION_KINDS = [
  "flow-progress",
  "flow-attempt",
  "flow-ghost",
  "flow-registry",
  "radar-registry",
  "radar",
  "flow-discovery",
  "flow-active-set",
  "flow-pass-registry",
  "flow-collection",
  "statement",
  "portfolio",
  "autopilot-pause",
  "autopilot-position",
  "autopilot-collector",
  "autopilot-policy",
  "receipt-hint",
  "wallet:active",
] as const;

/** Prune history only; modkit always keeps the latest row for each kind/key. */
export const job: WorkerJob = {
  name: "prune",
  intervalMs: HOUR / 4,
  async run(ctx) {
    const now = ctx.now();
    const deleted: Record<string, number> = {};
    for (const kind of DEFAULT_RETENTION_KINDS)
      deleted[kind] = ctx.store.prune({
        kind,
        olderThanMs: now - SNAPSHOT_RETENTION_MS.default,
      });
    for (const [kind, retentionMs] of Object.entries(SNAPSHOT_RETENTION_MS))
      if (kind !== "default")
        deleted[kind] = ctx.store.prune({ kind, olderThanMs: now - retentionMs });
    ctx.onWarn(`prune deleted rows by kind: ${JSON.stringify(deleted)}`);
  },
};
