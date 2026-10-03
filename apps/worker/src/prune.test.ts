import { expect, it, vi } from "vitest";
import { createFixtureEngine } from "@tally/engine";
import { EVIDENCE_SNAPSHOT_KINDS, openStore } from "@tally/modkit";
import { job, SNAPSHOT_RETENTION_MS } from "./jobs/prune";

it("hourly pruning applies 24h price, 2h prices, 6h registry and 7d default retention without deleting evidence or last-good data", async () => {
  const store = openStore(":memory:");
  const hour = 3_600_000;
  const now = 10 * 24 * hour;
  const kinds = ["price", "prices", "registry", "flow", ...EVIDENCE_SNAPSHOT_KINDS];
  try {
    for (const kind of kinds)
      for (const ageHours of [200, 100, 48, 24, 6, 2, 1])
        store.put({
          kind,
          key: "NVDA",
          data: ageHours,
          observedAt: now - ageHours * hour,
          source: "fixture",
        });
    for (const observedAt of [1, 2])
      store.put({
        kind: "price",
        key: "old-only",
        data: observedAt,
        observedAt,
        source: "fixture",
      });
    await job.run({
      store,
      health: store.health,
      engine: createFixtureEngine(),
      now: () => now,
      onWarn: vi.fn(),
    });
    expect(job.intervalMs).toBe(hour);
    expect(SNAPSHOT_RETENTION_MS).toEqual({
      price: 24 * hour,
      prices: 2 * hour,
      registry: 6 * hour,
      default: 7 * 24 * hour,
    });
    expect(store.history("price", "NVDA", 0).map((s) => s.data)).toEqual([24, 6, 2, 1]);
    expect(store.history("prices", "NVDA", 0).map((s) => s.data)).toEqual([2, 1]);
    expect(store.history("registry", "NVDA", 0).map((s) => s.data)).toEqual([6, 2, 1]);
    expect(store.history("flow", "NVDA", 0).map((s) => s.data)).toEqual([100, 48, 24, 6, 2, 1]);
    for (const kind of EVIDENCE_SNAPSHOT_KINDS)
      expect(store.history(kind, "NVDA", 0)).toHaveLength(7);
    expect(store.history("price", "old-only", 0).map((s) => s.observedAt)).toEqual([2]);
  } finally {
    store.close();
  }
});
