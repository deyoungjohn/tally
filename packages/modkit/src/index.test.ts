import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flags, MODULE_NAMES } from "@tally/config";
import {
  EVIDENCE_SNAPSHOT_KINDS,
  moduleHealthState,
  openStore,
  withFallback,
  type OpenSnapshotStore,
} from "./index";

const stores: OpenSnapshotStore[] = [];
const store = () => {
  const s = openStore(":memory:");
  stores.push(s);
  return s;
};
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});

describe("snapshot store", () => {
  it("skips identical latest observations but retains changed payloads and new timestamps", () => {
    const s = store();
    const snapshot = {
      kind: "price",
      key: "NVDA",
      data: { price: "180", shares: 1n },
      source: "fixture",
      observedAt: 100,
    };
    for (let poll = 0; poll < 100; poll++) s.put(snapshot);
    expect(s.history("price", "NVDA", 0)).toHaveLength(1);
    s.put({ ...snapshot, data: { price: "181", shares: 1n } });
    s.put({ ...snapshot, observedAt: 101 });
    s.put({ ...snapshot, key: "AAPL" });
    expect(s.history("price", "NVDA", 0)).toHaveLength(3);
    expect(s.history("price", "AAPL", 0)).toHaveLength(1);
  });
  it("prunes old history by kind/key, always keeps the latest, and supports keeping more observations", () => {
    const s = store();
    for (const kind of ["price", "registry"])
      for (const key of ["NVDA", "AAPL"])
        for (const observedAt of [10, 20, 30])
          s.put({ kind, key, data: observedAt, source: "fixture", observedAt });
    expect(s.prune({ kind: "price", olderThanMs: 100, keepLatest: 2 })).toBe(2);
    expect(s.history("price", "NVDA", 0).map((r) => r.observedAt)).toEqual([20, 30]);
    expect(s.history("registry", "NVDA", 0)).toHaveLength(3);
    expect(s.prune({ olderThanMs: 30 })).toBe(6);
    for (const kind of ["price", "registry"])
      for (const key of ["NVDA", "AAPL"])
        expect(s.history(kind, key, 0).map((r) => r.observedAt)).toEqual([30]);
    expect(s.prune({ olderThanMs: 100 })).toBe(0);
    expect(() => s.prune({ olderThanMs: 100, keepLatest: 0 })).toThrow(RangeError);
    expect(() => s.prune({ olderThanMs: NaN })).toThrow(RangeError);
  });
  it("protects receipt, decision and alert evidence by default, including explicit-kind pruning", () => {
    const s = store();
    for (const kind of EVIDENCE_SNAPSHOT_KINDS)
      for (const observedAt of [10, 20])
        s.put({ kind, key: "NVDA", data: observedAt, source: "fixture", observedAt });
    expect(s.prune({ olderThanMs: 100 })).toBe(0);
    expect(s.prune({ kind: "receipt", olderThanMs: 100 })).toBe(0);
    for (const kind of EVIDENCE_SNAPSHOT_KINDS) expect(s.history(kind, "NVDA", 0)).toHaveLength(2);
    expect(s.prune({ kind: "receipt", olderThanMs: 100, excludeKinds: [] })).toBe(1);
    expect(s.history("receipt", "NVDA", 0)[0]?.observedAt).toBe(20);
  });
  it("put/latest/history isolate kind and key, order by observation time and honor since/limit", () => {
    const s = store();
    expect(s.latest("flow", "NVDA", { maxAgeMs: 10, now: 0 })).toBeNull();
    for (const observedAt of [30, 10, 20])
      s.put({ kind: "flow", key: "NVDA", data: observedAt, source: "fixture", observedAt });
    s.put({ kind: "other", key: "NVDA", data: 0, source: "other", observedAt: 100 });
    s.put({ kind: "flow", key: "AAPL", data: 0, source: "other", observedAt: 100 });
    expect(s.latest("flow", "NVDA", { maxAgeMs: 10, now: 35 })).toMatchObject({
      data: 30,
      ageMs: 5,
      stale: false,
    });
    expect(s.history("flow", "NVDA", 20).map((r) => r.data)).toEqual([20, 30]);
    expect(s.history("flow", "NVDA", 0, 2).map((r) => r.data)).toEqual([10, 20]);
    expect(s.history("flow", "NVDA", 0, 0)).toEqual([]);
  });
  it("staleness is explicit, inclusive at the TTL boundary, and future clock skew has zero age", () => {
    const s = store();
    s.put({ kind: "flow", key: "NVDA", data: {}, source: "fixture", observedAt: 100 });
    expect(s.latest("flow", "NVDA", { maxAgeMs: 10, now: 110 })).toMatchObject({
      stale: false,
      ageMs: 10,
    });
    expect(s.latest("flow", "NVDA", { maxAgeMs: 10, now: 111 })).toMatchObject({
      stale: true,
      ageMs: 11,
    });
    expect(s.latest("flow", "NVDA", { maxAgeMs: 10, now: 99 })).toMatchObject({
      stale: false,
      ageMs: 0,
    });
    expect(() => s.latest("flow", "NVDA", { maxAgeMs: -1 })).toThrow(RangeError);
    expect(() => s.history("flow", "NVDA", 0, -1)).toThrow(RangeError);
  });
  it("nested bigint values round-trip without mistaking ordinary marker strings for bigints", () => {
    const s = store();
    const data = {
      shares: 123456789012345678901234567890n,
      nested: [0n, -5n],
      literal: "$tally:bigint:123",
      escaped: "$tally:string:value",
    };
    s.put({
      kind: "shares",
      key: "NVDA",
      data,
      source: "fixture",
      observedAt: 100,
      notes: ["recorded"],
    });
    expect(s.latest("shares", "NVDA", { maxAgeMs: 10, now: 100 })?.data).toEqual(data);
    expect(s.history("shares", "NVDA", 0)[0]).toMatchObject({ data, notes: ["recorded"] });
  });
  it("separate connections and reopen read persisted snapshots and collector health", () => {
    const dir = mkdtempSync(join(tmpdir(), "tally-modkit-"));
    try {
      const path = join(dir, "tally.db");
      const a = openStore(path);
      const b = openStore(path);
      try {
        a.put({ kind: "registry", key: "bsc", data: [1n], source: "fixture", observedAt: 100 });
        a.health.report("collect-registry", { ok: true, now: 100, intervalMs: 60_000 });
        b.put({ kind: "registry", key: "bsc", data: [1n], source: "fixture", observedAt: 100 });
        expect(a.history("registry", "bsc", 0)).toHaveLength(1);
        expect(b.latest("registry", "bsc", { maxAgeMs: 10, now: 100 })?.data).toEqual([1n]);
        expect(b.health.get("collect-registry")).toMatchObject({
          lastOkAt: 100,
          intervalMs: 60_000,
        });
      } finally {
        a.close();
        b.close();
      }
      const reopened = openStore(path);
      try {
        expect(reopened.health.all()).toHaveLength(1);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("health retains last good time after a failure, then clears the error on recovery", () => {
    const { health } = store();
    expect(health.get("flow")).toBeNull();
    health.report("flow", { ok: true, now: 100 });
    health.report("flow", { ok: false, error: "upstream unavailable", now: 200 });
    health.report("collect-prices", { ok: false, now: 200 });
    expect(health.get("flow")).toEqual({
      module: "flow",
      ok: false,
      lastRunAt: 200,
      lastOkAt: 100,
      lastError: "upstream unavailable",
    });
    health.report("flow", { ok: true, now: 300 });
    expect(health.get("flow")).toEqual({ module: "flow", ok: true, lastRunAt: 300, lastOkAt: 300 });
    expect(health.all().map((r) => r.module)).toEqual(["collect-prices", "flow"]);
  });
});

describe("module health freshness", () => {
  it("uses three job intervals for a five-minute module and the legacy 120s threshold when unknown", () => {
    const base = { module: "statement" as const, ok: true, lastRunAt: 0, lastOkAt: 0 };
    expect(moduleHealthState({ ...base, intervalMs: 300_000 }, 240_000)).toMatchObject({
      degraded: false,
      stale: false,
      ageMs: 240_000,
    });
    expect(moduleHealthState({ ...base, intervalMs: 300_000 }, 900_000).stale).toBe(false);
    expect(moduleHealthState({ ...base, intervalMs: 300_000 }, 900_001)).toMatchObject({
      degraded: true,
      stale: true,
      reason: "Worker update is overdue",
    });
    expect(moduleHealthState(base, 120_000).stale).toBe(false);
    expect(moduleHealthState(base, 120_001).stale).toBe(true);
  });
  it("exposes last-good age and failure reason, distinguishes never-succeeded, and retains the recorded cadence", () => {
    const { health } = store();
    health.report("guardian", { ok: true, now: 100, intervalMs: 60_000 });
    health.report("guardian", { ok: false, now: 200, error: "upstream unavailable" });
    expect(moduleHealthState(health.get("guardian"), 300)).toMatchObject({
      degraded: true,
      stale: false,
      ageMs: 200,
      reason: "upstream unavailable",
      health: { intervalMs: 60_000 },
    });
    health.report("rewards", { ok: false, now: 200, intervalMs: 60_000 });
    expect(moduleHealthState(health.get("rewards"), 300)).toMatchObject({
      degraded: true,
      ageMs: null,
      reason: "No successful update yet",
    });
    expect(moduleHealthState(null, 300).ageMs).toBeNull();
  });
});

describe("withFallback", () => {
  it("second source succeeds and every failed source warns with name and error kind", async () => {
    const warn = vi.fn();
    const error = Object.assign(new Error("down"), { kind: "network" });
    const unused = vi.fn();
    expect(
      await withFallback(
        [
          {
            name: "primary",
            run: async () => {
              throw error;
            },
          },
          { name: "secondary", run: async () => 42n },
          { name: "unused", run: unused },
        ],
        warn,
      ),
    ).toEqual({ value: 42n, source: "secondary" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("primary failed (network): down");
    expect(unused).not.toHaveBeenCalled();
  });
  it("all failures are aggregated, including non-Error throws, with one warning per failed step", async () => {
    const warn = vi.fn();
    const failed = withFallback(
      [
        {
          name: "primary",
          run: async () => {
            throw new TypeError("bad response");
          },
        },
        {
          name: "backup",
          run: async () => {
            throw "offline";
          },
        },
      ],
      warn,
    );
    await expect(failed).rejects.toMatchObject({
      name: "AggregateError",
      errors: [expect.any(Error), expect.any(Error)],
    });
    expect(warn.mock.calls.flat()).toEqual([
      "primary failed (TypeError): bad response",
      "backup failed (string): offline",
    ]);
    await expect(withFallback([], warn)).rejects.toThrow("no sources supplied");
  });
});

it("flags default all off and accept only FEATURE_<NAME>=1", () => {
  expect(flags({})).toEqual(Object.fromEntries(MODULE_NAMES.map((name) => [name, false])));
  const parsed = flags({
    FEATURE_FLOW: "1",
    FEATURE_QUALITY: "true",
    FEATURE_STATEMENT: "0",
    FEATURE_RECEIPTS: " 1",
    FEATURE_UNKNOWN: "1",
  });
  expect(parsed.flow).toBe(true);
  expect(Object.values(parsed).filter(Boolean)).toHaveLength(1);
  for (const name of MODULE_NAMES)
    expect(flags({ [`FEATURE_${name.toUpperCase()}`]: "1" })[name]).toBe(true);
});
