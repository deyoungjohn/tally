import { errorMessage, withFallback, type Snapshot } from "@tally/modkit";
import type { WorkerContext } from "./runner";

/** A failed poll retains the old observation time and reports unhealthy even if a cached copy exists. */
export async function collect<T>(
  ctx: WorkerContext,
  kind: string,
  key: string,
  maxAgeMs: number,
  read: () => Promise<Snapshot<T>>,
): Promise<void> {
  let primaryError: unknown;
  const result = await withFallback(
    [
      {
        name: "primary",
        run: async () => {
          try {
            return await read();
          } catch (error) {
            primaryError = error;
            throw error;
          }
        },
      },
      {
        name: "snapshot",
        run: async () => {
          const previous = ctx.store.latest<T>(kind, key, { maxAgeMs, now: ctx.now() });
          if (!previous) throw new Error(`No previous ${kind}/${key} snapshot`);
          ctx.onWarn(
            `Retaining ${kind}/${key} snapshot (${previous.ageMs} ms old, stale=${previous.stale})`,
          );
          return previous;
        },
      },
    ],
    ctx.onWarn,
  );
  if (result.source === "snapshot")
    throw new Error(
      `Primary source unavailable; retained old snapshot: ${errorMessage(primaryError)}`,
    );
  ctx.store.put(result.value);
}
