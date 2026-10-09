import { afterEach, expect, it, vi } from "vitest";
import { createRadarCache } from "./radar-cache";
import type { RadarVM } from "./view-model";
import { FLOW_MAX_AGE_MS } from "@tally/mod-flow";

const vm: RadarVM = {
  state: "empty",
  cards: [],
  filters: {},
  flowEnabled: true,
  source: null,
  stale: false,
  ageMs: null,
  reason: "Radar has no grade observations yet.",
  error: null,
};
afterEach(() => vi.useRealTimers());

it("single-flights equivalent filter sets and expires after twenty seconds", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  let resolve!: (value: RadarVM) => void;
  const load = vi.fn(
    () =>
      new Promise<RadarVM>((done) => {
        resolve = done;
      }),
  );
  const cached = createRadarCache(load);
  const a = cached({ flowEnabled: true, filters: { issuer: "ondo", ghost: false } });
  const b = cached({ flowEnabled: true, filters: { ghost: false, issuer: "ondo" } });
  expect(load).toHaveBeenCalledTimes(1);
  resolve(vm);
  expect(await a).toEqual(await b);
  await cached({ flowEnabled: true, filters: { issuer: "ondo", ghost: false } });
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(20000);
  const next = cached({ flowEnabled: true, filters: { issuer: "ondo", ghost: false } });
  expect(load).toHaveBeenCalledTimes(2);
  resolve(vm);
  await next;
});

it("different issuer, grade, ghost and flag values use separate cache keys", async () => {
  const load = vi.fn(async () => vm),
    cached = createRadarCache(load);
  for (const options of [
    {},
    { filters: { issuer: "ondo" as const } },
    { filters: { grade: "A" as const } },
    { filters: { ghost: false } },
    { filters: { ghost: true } },
    { flowEnabled: true },
  ])
    await cached({ ...options, flowEnabled: options.flowEnabled ?? false });
  expect(load).toHaveBeenCalledTimes(6);
});

it("thrown errors and loader error states are never cached", async () => {
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("store down"))
    .mockResolvedValueOnce({ ...vm, state: "error", error: "Snapshot store unavailable" })
    .mockResolvedValue(vm);
  const cached = createRadarCache(load);
  await expect(cached()).rejects.toThrow("store down");
  expect(await cached()).toMatchObject({ state: "error" });
  expect(await cached()).toEqual(vm);
  expect(await cached()).toEqual(vm);
  expect(load).toHaveBeenCalledTimes(3);
});

it("cached ages advance without changing windows; staleness boundaries force a fresh read", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const panel = {
    ticker: "NVDA",
    state: "ready",
    issuers: [
      {
        ageMs: FLOW_MAX_AGE_MS - 10000,
        stale: false,
        lastRealTradeAgeMs: 5000,
        windows: { "1h": { buys: 1 } },
      },
    ],
    ageMs: FLOW_MAX_AGE_MS - 10000,
  };
  const seeded = {
    ...vm,
    state: "ready",
    ageMs: 1000,
    cards: [{ ticker: "NVDA", grades: [{ ageMs: 1000, stale: false }], flowPanel: panel }],
  } as RadarVM;
  const load = vi.fn(async () => seeded),
    cached = createRadarCache(load);
  await cached();
  await vi.advanceTimersByTimeAsync(5000);
  const hit = await cached();
  expect(hit.ageMs).toBe(6000);
  expect(hit.cards[0]!.grades[0]!.ageMs).toBe(6000);
  expect(hit.cards[0]!.flowPanel!.issuers[0]!.lastRealTradeAgeMs).toBe(10000);
  expect(hit.cards[0]!.flowPanel!.issuers[0]!.windows).toEqual(panel.issuers[0]!.windows);
  expect(seeded.ageMs).toBe(1000);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5001);
  await cached();
  expect(load).toHaveBeenCalledTimes(2);
});
