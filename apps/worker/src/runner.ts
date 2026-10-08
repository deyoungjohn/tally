import type { Engine } from "@tally/engine";
import { errorMessage, type JobName, type ModuleHealth, type SnapshotStore } from "@tally/modkit";

export interface WorkerContext {
  store: SnapshotStore;
  health: ModuleHealth;
  engine: Engine;
  onWarn: (message: string) => void;
  now: () => number;
  /** Per-run cancellation; observe it in jobs that start long-running work. */
  signal?: AbortSignal;
}
export interface WorkerJob {
  name: JobName;
  intervalMs: number;
  timeoutMs?: number;
  run(context: WorkerContext): Promise<void>;
}

async function runOnce(
  job: WorkerJob,
  context: WorkerContext,
  shutdown: AbortSignal,
): Promise<void> {
  const timeoutMs = job.timeoutMs ?? Math.max(30_000, 2 * job.intervalMs);
  const controller = new AbortController();
  const assertActive = () => {
    if (controller.signal.aborted) throw controller.signal.reason;
  };
  // Late results from an uncooperative timed-out job must not overwrite newer snapshots or health.
  const runContext: WorkerContext = {
    ...context,
    signal: controller.signal,
    store: {
      latest: context.store.latest.bind(context.store),
      history: context.store.history.bind(context.store),
      listLatest: context.store.listLatest.bind(context.store),
      expire: (opts) => {
        assertActive();
        return context.store.expire(opts);
      },
      put: (snapshot) => {
        assertActive();
        context.store.put(snapshot);
      },
      prune: (opts) => {
        assertActive();
        return context.store.prune(opts);
      },
    },
    health: {
      get: context.health.get.bind(context.health),
      all: context.health.all.bind(context.health),
      report: (module, result) => {
        assertActive();
        context.health.report(module, result);
      },
    },
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const fail = (error: Error) => {
      controller.abort(error);
      reject(error);
    };
    stop = () => fail(new Error("Worker shutting down"));
    timer = setTimeout(() => fail(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    shutdown.addEventListener("abort", stop, { once: true });
    if (shutdown.aborted) stop();
  });
  try {
    await Promise.race([
      Promise.resolve().then(() => {
        assertActive();
        return job.run(runContext);
      }),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    shutdown.removeEventListener("abort", stop);
  }
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

/** Bookkeeping is best effort: a locked health table must not stop scheduling jobs. */
async function reportHealth(
  context: WorkerContext,
  name: JobName,
  result: Parameters<ModuleHealth["report"]>[1],
  signal: AbortSignal,
): Promise<void> {
  for (let attempt = 1; attempt <= 2 && !signal.aborted; attempt++) {
    try {
      context.health.report(name, result);
      return;
    } catch (error) {
      context.onWarn(`${name} health write failed (attempt ${attempt}/2): ${errorMessage(error)}`);
      if (attempt === 1) await wait(250, signal);
    }
  }
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
    if (job.timeoutMs !== undefined && (!Number.isFinite(job.timeoutMs) || job.timeoutMs <= 0))
      throw new RangeError(`${job.name}: timeoutMs must be positive`);
  }
  await Promise.all(
    jobs.map(async (job) => {
      let failures = 0;
      while (!signal.aborted) {
        try {
          await runOnce(job, context, signal);
          await reportHealth(
            context,
            job.name,
            {
              ok: true,
              now: context.now(),
              intervalMs: job.intervalMs,
            },
            signal,
          );
          failures = 0;
        } catch (error) {
          if (signal.aborted) break;
          failures++;
          await reportHealth(
            context,
            job.name,
            {
              ok: false,
              error: errorMessage(error),
              now: context.now(),
              intervalMs: job.intervalMs,
            },
            signal,
          );
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
