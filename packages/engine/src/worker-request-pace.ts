export interface WorkerRequestPaceOptions {
  requestsPerSecond: number;
  signal?: AbortSignal;
}

function wait(delay: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      if (signal?.aborted) reject(signal.reason);
      else resolve();
    };
    const timer = setTimeout(finish, delay);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/** Opt-in transport admission: includes concurrent facts reads and client retries, without bursts. */
export function workerRequestPace(transport: typeof fetch = fetch) {
  let options: WorkerRequestPaceOptions | undefined;
  let lastStarted: number | undefined;
  let queue = Promise.resolve();
  const pacedFetch: typeof fetch = (input, init) => {
    const active = options;
    if (!active) return transport(input, init);
    const admitted = queue.then(async () => {
      active.signal?.throwIfAborted();
      const delay =
        lastStarted === undefined
          ? 0
          : Math.max(0, lastStarted + 1000 / active.requestsPerSecond - Date.now());
      if (delay > 0) await wait(Math.ceil(delay), active.signal);
      active.signal?.throwIfAborted();
      lastStarted = Date.now();
    });
    // A cancelled admission rejects its own caller, but must not poison later runs' queue.
    queue = admitted.then(
      () => undefined,
      () => undefined,
    );
    return admitted.then(() => {
      active.signal?.throwIfAborted();
      const signals = [init?.signal, active.signal].filter(
        (signal): signal is AbortSignal => signal != null,
      );
      return transport(input, {
        ...init,
        signal: signals.length ? AbortSignal.any(signals) : undefined,
      });
    });
  };
  return {
    fetch: pacedFetch,
    configure(next: WorkerRequestPaceOptions) {
      if (!Number.isFinite(next.requestsPerSecond) || next.requestsPerSecond <= 0)
        throw new RangeError("Worker requestsPerSecond must be positive and finite");
      options = next;
    },
    aborted: () => options?.signal?.aborted === true,
  };
}
