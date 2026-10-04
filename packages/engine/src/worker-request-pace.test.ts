import { expect, it, vi } from "vitest";
import { BinanceClient, createFixtureFetch, rwaPricesResponse } from "@tally/binance";
import { createFixtureEngine, createLiveEngine } from "./engine";
import { workerRequestPace } from "./worker-request-pace";

it("a live engine built without onWarn does not call console.warn on a facts fallback", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const fixture = createFixtureFetch();
  const failedList = vi.fn();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).includes("/market/rwa/tokens")) {
      failedList();
      return new Response(JSON.stringify({ code: 40001, msg: "mock list failure" }));
    }
    return fixture(input, init);
  });
  try {
    const token = (await createFixtureEngine().ports.registry.tokensFor("NVDA")).find(
      (row) => row.issuer === "ondo",
    )!;
    const engine = createLiveEngine({
      BINANCE_W3_API_KEY: "fixture",
      BINANCE_W3_API_SECRET: "fixture",
      BSC_RPC_PRIMARY: "https://rpc.example.invalid",
    });
    const facts = await engine.ports.facts.market(token);
    expect(failedList).toHaveBeenCalledOnce();
    expect(facts.status).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});

it("opt-in live worker pacing spaces concurrent collector requests without changing unconfigured engines", async () => {
  vi.useFakeTimers();
  try {
    const times: number[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      times.push(Date.now());
      return new Response(JSON.stringify({ code: "000000", data: [] }));
    });
    const engine = createLiveEngine({
      BINANCE_W3_API_KEY: "fixture",
      BINANCE_W3_API_SECRET: "fixture",
    });
    const token = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436";
    await Promise.all([engine.collectors.holders(token), engine.collectors.topTraders(token)]);
    expect(times[1]).toBe(times[0]);
    times.length = 0;
    engine.paceWorkerRequests!({ requestsPerSecond: 2 });
    const reads = Promise.all([
      engine.collectors.holders(token),
      engine.collectors.topTraders(token),
      engine.collectors.topLiquidity(token),
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    await reads;
    expect(times.map((t) => t - times[0]!)).toEqual([0, 500, 1000]);
  } finally {
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});

it("worker transport paces the individual requests inside facts, including public fallbacks", async () => {
  vi.useFakeTimers();
  try {
    const times: number[] = [];
    const fixture = createFixtureFetch();
    const pace = workerRequestPace(async (...args) => {
      times.push(Date.now());
      return fixture(...args);
    });
    pace.configure({ requestsPerSecond: 2 });
    const engine = createFixtureEngine({ fetch: pace.fetch });
    const facts = engine.facts("NVDA");
    await vi.runAllTimersAsync();
    const rows = await facts;
    expect(rows.length).toBeGreaterThan(0);
    expect(times.length).toBeGreaterThan(4);
    expect(times.slice(1).every((t, i) => t - times[i]! >= 500)).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("configured worker pace includes signed-client retries and has no concurrent burst", async () => {
  vi.useFakeTimers();
  try {
    const times: number[] = [];
    const pace = workerRequestPace(async () => {
      times.push(Date.now());
      return new Response(
        JSON.stringify({ code: times.length === 1 ? 42900 : "000000", data: [] }),
      );
    });
    pace.configure({ requestsPerSecond: 1 });
    const client = new BinanceClient({
      apiKey: "fixture",
      apiSecret: "fixture",
      fetch: pace.fetch,
      ratePerSec: 1000,
      burst: 1000,
      retries: 1,
    });
    const reads = Promise.all([
      client.get("/fixture", {}, rwaPricesResponse),
      client.get("/fixture", {}, rwaPricesResponse),
      client.get("/fixture", {}, rwaPricesResponse),
    ]);
    await vi.runAllTimersAsync();
    await reads;
    expect(times).toHaveLength(4);
    expect(times.map((t) => t - times[0]!)).toEqual([0, 1000, 2000, 3000]);
  } finally {
    vi.useRealTimers();
  }
});

it("abort cancels queued and in-flight worker fetches, and a later run can resume", async () => {
  vi.useFakeTimers();
  try {
    const controller = new AbortController();
    const transport = vi.fn<typeof fetch>(async (_input, init) => {
      return new Promise<Response>((resolve, reject) => {
        if (transport.mock.calls.length > 1) resolve(new Response());
        else init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    });
    const pace = workerRequestPace(transport);
    pace.configure({ requestsPerSecond: 2, signal: controller.signal });
    const reads = Promise.allSettled([pace.fetch("/fixture"), pace.fetch("/fixture")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(1);
    controller.abort();
    expect((await reads).map((r) => r.status)).toEqual(["rejected", "rejected"]);
    pace.configure({ requestsPerSecond: 2, signal: new AbortController().signal });
    const next = pace.fetch("/fixture");
    await vi.advanceTimersByTimeAsync(500);
    await next;
    expect(transport).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
