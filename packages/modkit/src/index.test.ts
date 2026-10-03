import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flags, MODULE_NAMES } from "@tally/config";
import { openStore, withFallback, type OpenSnapshotStore } from "./index";

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
        a.health.report("collect-registry", { ok: true, now: 100 });
        expect(b.latest("registry", "bsc", { maxAgeMs: 10, now: 100 })?.data).toEqual([1n]);
        expect(b.health.get("collect-registry")?.lastOkAt).toBe(100);
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
