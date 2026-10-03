import { afterEach, expect, it, vi } from "vitest";
import { createFixtureEngine } from "@tally/engine";
import { openStore } from "@tally/modkit";
import { runJobs, type WorkerContext } from "./runner";
import { collect } from "./collect";

afterEach(() => vi.useRealTimers());

it("a job that always throws keeps running with backoff while a sibling stays healthy; abort stops both", async () => {
  vi.useFakeTimers();
  const store = openStore(":memory:");
  const stop = new AbortController();
  const onWarn = vi.fn();
  const ctx: WorkerContext = {
    store,
    health: store.health,
    engine: createFixtureEngine(),
    now: Date.now,
    onWarn,
  };
  const bad = vi.fn(async () => {
    throw new Error("primary is down");
  });
  const good = vi.fn(async () => {});
  const loop = runJobs(
    [
      { name: "flow", intervalMs: 10, run: bad },
      { name: "guardian", intervalMs: 10, run: good },
    ],
    ctx,
    stop.signal,
  );
  try {
    await vi.advanceTimersByTimeAsync(100);
    expect(bad).toHaveBeenCalledTimes(3); // t=0,20,60; backoff doubles
    expect(good).toHaveBeenCalledTimes(11);
    expect(store.health.get("flow")).toMatchObject({ ok: false, lastError: "primary is down" });
    expect(store.health.get("guardian")).toMatchObject({ ok: true, lastOkAt: Date.now() });
    expect(onWarn).toHaveBeenCalledTimes(3);
    stop.abort();
    await loop;
    await vi.advanceTimersByTimeAsync(100);
    expect(bad).toHaveBeenCalledTimes(3);
    expect(good).toHaveBeenCalledTimes(11);
  } finally {
    stop.abort();
    await loop;
    store.close();
  }
});

it("primary failure retains a stale snapshot's source/time, warns, and marks the collector unhealthy", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const store = openStore(":memory:");
  const stop = new AbortController();
  const onWarn = vi.fn();
  store.put({ kind: "registry", key: "bsc", data: [1n], source: "last-good", observedAt: 10 });
  store.health.report("collect-registry", { ok: true, now: 10 });
  const ctx: WorkerContext = {
    store,
    health: store.health,
    engine: createFixtureEngine(),
    now: Date.now,
    onWarn,
  };
  const loop = runJobs(
    [
      {
        name: "collect-registry",
        intervalMs: 100,
        run: (ctx) =>
          collect(ctx, "registry", "bsc", 100, async () => {
            throw new Error("network down");
          }),
      },
    ],
    ctx,
    stop.signal,
  );
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(store.latest("registry", "bsc", { maxAgeMs: 100, now: 1000 })).toMatchObject({
      observedAt: 10,
      ageMs: 990,
      stale: true,
      source: "last-good",
    });
    expect(store.history("registry", "bsc", 0)).toHaveLength(1);
    expect(store.health.get("collect-registry")).toMatchObject({
      ok: false,
      lastOkAt: 10,
      lastError: expect.stringContaining("network down"),
    });
    expect(onWarn.mock.calls.flat().join("\n")).toContain("stale=true");
  } finally {
    stop.abort();
    await loop;
    store.close();
  }
});
