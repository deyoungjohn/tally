import type { Engine } from "@tally/engine";
import { errorMessage, type JobName, type ModuleHealth, type SnapshotStore } from "@tally/modkit";

export interface WorkerContext {
  store: SnapshotStore;
  health: ModuleHealth;
  engine: Engine;
  onWarn: (message: string) => void;
  now: () => number;
}
export interface WorkerJob {
  name: JobName;
  intervalMs: number;
  run(context: WorkerContext): Promise<void>;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Independent loops: one failing or slow job cannot delay a sibling. */
export async function runJobs(
  jobs: readonly WorkerJob[],
  context: WorkerContext,
  signal: AbortSignal,
): Promise<void> {
  for (const job of jobs) {
    if (!Number.isFinite(job.intervalMs) || job.intervalMs <= 0)
      throw new RangeError(`${job.name}: intervalMs must be positive`);
  }
  await Promise.all(
    jobs.map(async (job) => {
      let failures = 0;
      while (!signal.aborted) {
        try {
          await job.run(context);
          context.health.report(job.name, { ok: true, now: context.now() });
          failures = 0;
        } catch (error) {
          failures++;
          context.health.report(job.name, {
            ok: false,
            error: errorMessage(error),
            now: context.now(),
          });
          context.onWarn(`${job.name} failed: ${errorMessage(error)}`);
        }
        const backoff = Math.min(
          job.intervalMs * 2 ** Math.min(failures, 10),
          Math.max(job.intervalMs, 900_000),
        );
        await wait(backoff, signal);
      }
    }),
  );
}
