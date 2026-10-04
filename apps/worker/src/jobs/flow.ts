import { aggregateFlow, FLOW_MAX_AGE_MS, type FlowSnapshot, type FlowToken } from "@tally/mod-flow";
import type { WorkerJob } from "../runner";

/** Snapshot-only module loop; timestamps belong to the source, never to this recomputation. */
export const job: WorkerJob = {
  name: "flow",
  intervalMs: 60_000,
  async run(ctx) {
    if (process.env.FEATURE_FLOW !== "1") return;
    const registry = ctx.store.latest<FlowToken[]>("flow-registry", "bsc", {
      maxAgeMs: FLOW_MAX_AGE_MS,
      now: ctx.now(),
    });
    if (!registry) throw new Error("No flow registry; start collect-flow first");
    let failures = 0;
    for (const token of registry.data) {
      const snapshot = ctx.store.latest<FlowSnapshot>("flow", token.address.toLowerCase(), {
        maxAgeMs: FLOW_MAX_AGE_MS,
        now: ctx.now(),
      });
      if (!snapshot) {
        failures++;
        ctx.onWarn(`Flow ${token.symbol} has no snapshot`);
        continue;
      }
      if (snapshot.stale) {
        failures++;
        ctx.onWarn(`Flow ${token.symbol} is stale (${snapshot.ageMs} ms)`);
      }
      ctx.store.put({
        kind: "flow-aggregate",
        key: token.address.toLowerCase(),
        source: snapshot.source,
        observedAt: snapshot.observedAt,
        notes: snapshot.notes,
        data: aggregateFlow(snapshot.data, ctx.now()),
      });
    }
    if (failures) throw new Error(`${failures} flow snapshots missing or stale`);
  },
};
