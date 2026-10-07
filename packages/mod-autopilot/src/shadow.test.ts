import { readFileSync } from "node:fs";
import { openStore, type OpenSnapshotStore, type SnapshotStore } from "@tally/modkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { job } from "../../../apps/worker/src/jobs/autopilot";
import { runJobs, type WorkerContext } from "../../../apps/worker/src/runner";
import { appendDecisionRows, DECISION_LOG_KEY, readDecisionLog } from "./log";
import { positionKey, runShadow } from "./shadow";
import {
  constructedAlert,
  constructedPolicy,
  constructedPosition,
  constructedRow,
  CONSTRUCTED_NOW as now,
  CONSTRUCTED_WALLET as wallet,
  CONSTRUCTED_TOKEN as token,
} from "./fixtures";

const stores: OpenSnapshotStore[] = [];
function seeded() {
  const store = openStore(":memory:");
  stores.push(store);
  store.put({
    kind: "alerts",
    key: wallet,
    data: [constructedAlert()],
    source: "constructed",
    observedAt: now,
  });
  store.put({
    kind: "autopilot-policy",
    key: wallet,
    data: constructedPolicy(),
    source: "constructed",
    observedAt: now,
  });
  store.put({
    kind: "autopilot-position",
    key: positionKey(wallet, token),
    data: constructedPosition(),
    source: "constructed chain",
    observedAt: now,
  });
  return store;
}
const context = (store: OpenSnapshotStore): WorkerContext => ({
  store,
  health: store.health,
  now: () => now,
  onWarn: vi.fn(),
  engine: new Proxy({} as WorkerContext["engine"], {
    get: () => {
      throw new Error("Engine must never be accessed");
    },
  }),
});
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("decision batches are append-only, one logical row per alert, and protected against prune/expire", () => {
  const store = seeded();
  appendDecisionRows(store, [constructedRow()], now);
  appendDecisionRows(store, [constructedRow({ alertId: "second" })], now + 1);
  expect(() => appendDecisionRows(store, [constructedRow()], now + 2)).toThrow(
    "already in decision log",
  );
  expect(store.prune({ olderThanMs: now + 1000, excludeKinds: [] })).toBe(0);
  expect(() => store.expire({ kind: "decision", olderThanMs: now + 1000 })).toThrow(
    "protected evidence",
  );
  expect(readDecisionLog(store).map((r) => r.alertId)).toEqual(["previous-alert", "second"]);
  expect(store.history("decision", DECISION_LOG_KEY, 0)).toHaveLength(2);
});

it("reads the entire protected log beyond listLatest's 1000 row bound", () => {
  const store = seeded();
  for (let i = 0; i < 1005; i++)
    store.put({
      kind: "decision",
      key: DECISION_LOG_KEY,
      data: { rows: [constructedRow({ alertId: `old-${i}` })] },
      source: "constructed",
      observedAt: i,
    });
  expect(readDecisionLog(store)).toHaveLength(1005);
});

describe("actual worker job", () => {
  it("flag off reads and writes nothing; flag on has no execute call or engine access", async () => {
    vi.stubEnv("FEATURE_AUTOPILOT", undefined);
    const store = seeded();
    const ctx = context(store);
    const read = vi.spyOn(store, "listLatest");
    await job.run(ctx);
    expect(read).not.toHaveBeenCalled();
    expect(readDecisionLog(store)).toHaveLength(0);
    vi.stubEnv("FEATURE_AUTOPILOT", "1");
    await job.run(ctx);
    const rows = readDecisionLog(store);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      mode: "shadow",
      decision: "execute",
      inputs: { spentToday: 0n },
      leg: { tokens: (25n * 10n ** 18n) / 10n },
    });
    expect(rows[0]?.receiptId).toBeUndefined();
    expect(Object.keys(job)).toEqual(["name", "intervalMs", "timeoutMs", "run"]);
    const code = readFileSync(
      new URL("../../../apps/worker/src/jobs/autopilot.ts", import.meta.url),
      "utf8",
    );
    expect(code).not.toMatch(/\.execute\s*\(|child_process|\bfetch\s*\(|\bbaw\b/);
    await job.run(ctx);
    expect(readDecisionLog(store)).toHaveLength(1);
  });
  it("failure after staging a first row writes nothing and preserves last good log", async () => {
    vi.stubEnv("FEATURE_AUTOPILOT", "1");
    const store = seeded();
    appendDecisionRows(store, [constructedRow()], now - 1);
    store.put({
      kind: "alerts",
      key: wallet,
      data: [constructedAlert(), constructedAlert({ id: "second" })],
      source: "constructed",
      observedAt: now,
    });
    const original = store.latest.bind(store);
    let reads = 0;
    vi.spyOn(store, "latest").mockImplementation((kind, key, opts) => {
      if (kind === "autopilot-position" && ++reads === 2) throw new Error("primary source failed");
      return original(kind, key, opts);
    });
    const ctx = context(store);
    await expect(job.run(ctx)).rejects.toThrow("primary source failed");
    expect(readDecisionLog(store).map((r) => r.alertId)).toEqual(["previous-alert"]);
    expect(ctx.onWarn).toHaveBeenCalledWith(
      "Autopilot shadow evaluation failed; decision log unchanged",
    );
  });
  it("atomic commit failure retains the last good batch", async () => {
    vi.stubEnv("FEATURE_AUTOPILOT", "1");
    const store = seeded();
    appendDecisionRows(store, [constructedRow()], now - 1);
    const put = vi.spyOn(store, "put").mockImplementation(() => {
      throw new Error("store unavailable");
    });
    await expect(job.run(context(store))).rejects.toThrow("store unavailable");
    expect(put).toHaveBeenCalledTimes(1);
    expect(readDecisionLog(store)).toHaveLength(1);
  });
  it("timeout blocks late writes and preserves last successful health and log", async () => {
    vi.useFakeTimers();
    vi.stubEnv("FEATURE_AUTOPILOT", "1");
    const store = seeded();
    appendDecisionRows(store, [constructedRow()], now - 1);
    store.health.report("autopilot", { ok: true, now: now - 1 });
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => {
      release = resolve;
    });
    const shutdown = new AbortController();
    const running = runJobs(
      [
        {
          ...job,
          timeoutMs: 10,
          async run(ctx) {
            await deferred;
            await job.run(ctx);
          },
        },
      ],
      context(store),
      shutdown.signal,
    );
    await vi.advanceTimersByTimeAsync(11);
    release();
    await vi.advanceTimersByTimeAsync(1);
    expect(readDecisionLog(store)).toHaveLength(1);
    expect(store.health.get("autopilot")).toMatchObject({
      ok: false,
      lastOkAt: now - 1,
      lastError: "timed out after 10 ms",
    });
    shutdown.abort();
    await running;
  });
});

it("missing sizing source and stale snapshots write reasoned alert-only shadow rows", () => {
  const store = seeded();
  store.put({
    kind: "autopilot-position",
    key: positionKey(wallet, token),
    data: constructedPosition({ observedAt: now - 60_001 }),
    source: "constructed stale chain",
    observedAt: now,
  });
  runShadow({ store, now: () => now, onWarn: vi.fn() });
  expect(readDecisionLog(store)[0]).toMatchObject({
    decision: "alertOnly",
    reasons: ["position stale"],
    mode: "shadow",
  });
  const missing = seeded();
  const masked: SnapshotStore = {
    ...missing,
    latest: (kind, key, opts) =>
      kind === "autopilot-position" ? null : missing.latest(kind, key, opts),
  };
  runShadow({ store: masked, now: () => now, onWarn: vi.fn() });
  expect(readDecisionLog(missing)[0]?.reasons).toContain("unknown shares");
});
it("old snapshot metadata cannot hide behind a fresh payload", () => {
  const store = seeded();
  const original = store.latest.bind(store);
  vi.spyOn(store, "latest").mockImplementation((kind, key, opts) => {
    const snap = original(kind, key, opts);
    return snap && kind === "autopilot-position" ? { ...snap, stale: true } : snap;
  });
  runShadow({ store, now: () => now, onWarn: vi.fn() });
  expect(readDecisionLog(store)[0]).toMatchObject({
    decision: "alertOnly",
    reasons: ["position stale"],
  });
  expect(readDecisionLog(store)[0]?.leg).toBeUndefined();
});
it("missing/stale policy unarms rules and warns; no execution by default", () => {
  const store = seeded();
  const ctx = { store, now: () => now + 86_400_001, onWarn: vi.fn() };
  runShadow(ctx);
  expect(readDecisionLog(store)[0]?.reasons).toContain("rule not armed");
  expect(ctx.onWarn).toHaveBeenCalledWith("Autopilot policy missing or stale; rules are unarmed");
});
it("one batch contains multiple wallet-isolated alert decisions", () => {
  const store = seeded();
  const otherWallet = "0x0000000000000000000000000000000000000003";
  store.put({
    kind: "alerts",
    key: otherWallet,
    data: [constructedAlert({ id: "other-alert", walletAddress: otherWallet })],
    source: "constructed",
    observedAt: now,
  });
  runShadow({ store, now: () => now, onWarn: vi.fn() });
  expect(readDecisionLog(store)).toHaveLength(2);
  expect(store.history("decision", DECISION_LOG_KEY, 0)).toHaveLength(1);
  expect(readDecisionLog(store).find((r) => r.walletAddress === otherWallet)?.decision).toBe(
    "alertOnly",
  );
});

it("stale alert feed metadata downgrades even fresh alert payloads", () => {
  const store = seeded();
  const read = store.listLatest.bind(store);
  vi.spyOn(store, "listLatest").mockImplementation((kind, opts) =>
    read(kind, opts).map((snap) => ({ ...snap, stale: true })),
  );
  runShadow({ store, now: () => now, onWarn: vi.fn() });
  expect(readDecisionLog(store)[0]).toMatchObject({
    decision: "alertOnly",
    reasons: ["alert stale"],
  });
  expect(readDecisionLog(store)[0]?.leg).toBeUndefined();
});
