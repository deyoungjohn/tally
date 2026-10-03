import type { WorkerJob } from "../runner";

const HOUR = 60 * 60 * 1000;
export const SNAPSHOT_RETENTION_MS = {
  price: 24 * HOUR,
  prices: 2 * HOUR,
  registry: 6 * HOUR,
  default: 7 * 24 * HOUR,
} as const;

/** Modkit excludes receipt(s), decision(s), and alert(s), even from the default-kind sweep. */
export const job: WorkerJob = {
  name: "prune",
  intervalMs: HOUR,
  async run(ctx) {
    const now = ctx.now();
    ctx.store.prune({ olderThanMs: now - SNAPSHOT_RETENTION_MS.default });
    for (const kind of ["price", "prices", "registry"] as const) {
      ctx.store.prune({ kind, olderThanMs: now - SNAPSHOT_RETENTION_MS[kind] });
    }
  },
};
