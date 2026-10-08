import { afterEach, expect, it, vi } from "vitest";
import { createFixtureEngine } from "@tally/engine";
import { EVIDENCE_SNAPSHOT_KINDS, openStore } from "@tally/modkit";
import { job, SNAPSHOT_RETENTION_MS } from "./jobs/prune";

const HOUR = 3_600_000;
const policies: [string, number][] = [
  ["price", 24 * HOUR],
  ["prices", 2 * HOUR],
  ["registry", 6 * HOUR],
  ...["flow", "flow-traders", "flow-holders", "flow-pools"].map((kind): [string, number] => [
    kind,
    HOUR / 2,
  ]),
  ["flow-aggregate", 24 * HOUR],
  ...[
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
  ].map((kind): [string, number] => [kind, 7 * 24 * HOUR]),
];

function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(10 * 24 * HOUR);
  const store = openStore(":memory:");
  const ctx = {
    store,
    health: store.health,
    engine: createFixtureEngine(),
    now: Date.now,
    onWarn: vi.fn(),
  };
  function put(kind: string, key: string, observedAt: number, data = "fixture payload") {
    store.put({ kind, key, observedAt, data, source: "fixture" });
  }
  return { store, ctx, put };
}

afterEach(() => vi.useRealTimers());

it.each(policies)(
  "quarter-hour pruning applies %s retention (%i ms) with a fake clock",
  async (kind, retentionMs) => {
    const { store, ctx, put } = setup();
    try {
      const cutoff = ctx.now() - retentionMs;
      for (const timestamp of [cutoff - 1, cutoff, cutoff + 1]) put(kind, "NVDA", timestamp);
      await job.run(ctx);
      expect(job.intervalMs).toBe(HOUR / 4);
      expect(SNAPSHOT_RETENTION_MS.default).toBe(7 * 24 * HOUR);
      expect(store.history(kind, "NVDA", 0).map((s) => s.observedAt)).toEqual([cutoff, cutoff + 1]);
      await vi.advanceTimersByTimeAsync(2);
      await job.run(ctx);
      expect(store.history(kind, "NVDA", 0).map((s) => s.observedAt)).toEqual([cutoff + 1]);
    } finally {
      store.close();
    }
  },
);

it("prune leaves receipts, decisions, alerts and all guardian kinds untouched", async () => {
  const { store, ctx, put } = setup();
  const kinds = [
    ...EVIDENCE_SNAPSHOT_KINDS,
    "guardian-state",
    "guardian-settings",
    "guardian-link-code",
    "guardian-active-code",
    "guardian-link-attempt",
    "guardian-link",
    "guardian-chat",
    "guardian-future-kind",
  ];
  const prune = vi.spyOn(store, "prune");
  try {
    for (const kind of kinds) for (const timestamp of [1, 2, 3]) put(kind, "wallet", timestamp);
    const before = kinds.map((kind) => store.history(kind, "wallet", 0));
    put("flow", "NVDA", 1);
    put("flow", "NVDA", 2);
    await job.run(ctx);
    expect(store.history("flow", "NVDA", 0)).toHaveLength(1);
    expect(kinds.map((kind) => store.history(kind, "wallet", 0))).toEqual(before);
    for (const [options] of prune.mock.calls) {
      expect(options.kind).toBeDefined();
      expect(kinds).not.toContain(options.kind);
      expect(options.kind).not.toMatch(/^guardian-/);
    }
  } finally {
    store.close();
  }
});

it("every retained kind keeps the latest row of every key even when the collector is stale", async () => {
  const { store, ctx, put } = setup();
  try {
    for (const [kind] of policies) {
      for (const key of ["NVDA", "AAPL"]) {
        put(kind, key, 1);
        put(kind, key, 2, "earlier payload at tied timestamp");
        put(kind, key, 2, "last good payload");
      }
    }
    await job.run(ctx);
    for (const [kind, maxAgeMs] of policies)
      for (const key of ["NVDA", "AAPL"]) {
        expect(store.history(kind, key, 0)).toHaveLength(1);
        expect(store.latest(kind, key, { maxAgeMs, now: ctx.now() })).toMatchObject({
          data: "last good payload",
          observedAt: 2,
          stale: true,
          ageMs: ctx.now() - 2,
        });
      }
  } finally {
    store.close();
  }
});

it("logs exact per-kind deleted-row counts once per sweep, without snapshot payloads", async () => {
  const { store, ctx, put } = setup();
  try {
    for (const timestamp of [1, 2, 3]) put("flow", "NVDA", timestamp, "must not be logged");
    for (const timestamp of [1, 2]) put("flow-traders", "NVDA", timestamp);
    for (const timestamp of [1, 2]) put("flow-progress", "NVDA", timestamp);
    await job.run(ctx);
    expect(ctx.onWarn).toHaveBeenCalledTimes(1);
    const message = ctx.onWarn.mock.calls[0]![0] as string;
    const counts = JSON.parse(message.slice("prune deleted rows by kind: ".length)) as Record<
      string,
      number
    >;
    expect(counts).toEqual(
      Object.fromEntries(
        policies.map(([kind]) => [
          kind,
          kind === "flow" ? 2 : kind === "flow-traders" || kind === "flow-progress" ? 1 : 0,
        ]),
      ),
    );
    expect(message).not.toContain("must not be logged");
    await job.run(ctx);
    expect(ctx.onWarn).toHaveBeenCalledTimes(2);
    const next = JSON.parse(
      ctx.onWarn.mock.calls[1]![0].slice("prune deleted rows by kind: ".length),
    ) as Record<string, number>;
    expect(Object.values(next).every((count) => count === 0)).toBe(true);
  } finally {
    store.close();
  }
});
