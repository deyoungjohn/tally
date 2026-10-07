import { runShadow } from "@tally/mod-autopilot";
import type { WorkerJob } from "../runner";

/** Registered by the worker CLI's filename loader. Slice A has no execution port. */
export const job: WorkerJob = {
  name: "autopilot",
  intervalMs: 60_000,
  timeoutMs: 30_000,
  async run(ctx) {
    if (process.env.FEATURE_AUTOPILOT !== "1") return;
    runShadow(ctx);
  },
};
