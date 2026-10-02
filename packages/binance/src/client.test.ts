import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BinanceClient } from "./client";
import { BinanceApiError } from "./errors";
import { sign } from "./signing";

const anyData = z.unknown();
const body = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

function make(responses: Array<Response | Error>, o: { t?: { v: number }; retries?: number } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const sleeps: number[] = [];
  const t = o.t ?? { v: Date.UTC(2026, 9, 2, 3, 0, 0, 0) };
  let i = 0;
  const client = new BinanceClient({
    apiKey: "KEY",
    apiSecret: "test-secret",
    now: () => t.v,
    sleep: async (ms) => {
      sleeps.push(ms);
      t.v += ms;
    },
    retries: o.retries,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      const r = responses[Math.min(i++, responses.length - 1)]!;
      if (r instanceof Error) throw r;
      return r.clone();
    }) as unknown as typeof fetch,
  });
  return { client, calls, sleeps, t };
}

const ok = (data: unknown) => body({ code: 0, msg: "success", data, success: true });

describe("BinanceClient", () => {
  it("sends the four X-OC headers, signs path + /build, and returns the data", async () => {
    const { client, calls } = make([ok([{ a: 1 }])]);
    const data = await client.get(
      "/api/v1/dex/aggregator/supported/chain",
      { binanceChainId: "56", skip: undefined },
      anyData,
    );
    expect(data).toEqual([{ a: 1 }]);
    const { url, init } = calls[0]!;
    expect(url).toBe(
      "https://web3.binance.com/build/api/v1/dex/aggregator/supported/chain?binanceChainId=56",
    );
    const h = init.headers as Record<string, string>;
    expect(h["X-OC-APIKEY"]).toBe("KEY");
    expect(h["X-OC-RECV-WINDOW"]).toBe("10000");
    expect(h["X-OC-TIMESTAMP"]).toBe("2026-10-02T03:00:00.000Z");
    expect(h["X-OC-SIGN"]).toBe(
      sign({
        secret: "test-secret",
        timestamp: h["X-OC-TIMESTAMP"]!,
        method: "GET",
        path: "/api/v1/dex/aggregator/supported/chain",
        query: "binanceChainId=56",
      }),
    );
  });

  it("accepts both success codes: 0 and '000000'", async () => {
    await expect(
      make([body({ code: "000000", data: 1 })]).client.get("/p", {}, anyData),
    ).resolves.toBe(1);
    await expect(make([body({ code: 0, data: 2 })]).client.get("/p", {}, anyData)).resolves.toBe(2);
  });

  it("an error code inside an HTTP 200 is an error (V6: 40304 passes any status-only client)", async () => {
    const { client } = make([
      body(
        { code: 40304, msg: "Service not available due to compliance restriction", success: false },
        200,
      ),
    ]);
    const e = await client.get("/p", {}, anyData).catch((x) => x);
    expect(e).toBeInstanceOf(BinanceApiError);
    expect(e).toMatchObject({ kind: "region_block", code: 40304, http: 200 });
  });

  it("maps codes to kinds, including the documented 4030x range and 40375/40001/40103", async () => {
    const kind = async (code: number, status = 200) =>
      (
        (await make([body({ code, msg: "m" }, status)], { retries: 0 })
          .client.get("/p", {}, anyData)
          .catch((x) => x)) as BinanceApiError
      ).kind;
    expect(await kind(40301)).toBe("region_block");
    expect(await kind(40302)).toBe("region_block");
    expect(await kind(40375)).toBe("below_minimum");
    expect(await kind(40001)).toBe("param");
    expect(await kind(40101, 401)).toBe("auth");
    expect(await kind(40103, 401)).toBe("auth");
    expect(await kind(40401)).toBe("quote_expired");
    expect(await kind(40462)).toBe("quote_expired");
    expect(await kind(40367)).toBe("token_unavailable");
    expect(await kind(40311)).toBe("compliance");
    expect(await kind(50001, 503)).toBe("upstream");
    expect(await kind(49999)).toBe("unknown");
  });

  it("never retries a 4xxxx code (region block, minimum, param, auth)", async () => {
    for (const code of [40304, 40375, 40001, 40101, 40401]) {
      const { client, calls, sleeps } = make([body({ code, msg: "x" })]);
      await client.get("/p", {}, anyData).catch(() => undefined);
      expect(calls, `code ${code}`).toHaveLength(1);
      expect(sleeps).toEqual([]);
    }
  });

  it("retries network errors and 5xx twice with backoff, then succeeds", async () => {
    const { client, calls, sleeps } = make([
      new Error("ECONNRESET"),
      body({ code: 50001, msg: "down" }, 503),
      ok("fine"),
    ]);
    await expect(client.get("/p", {}, anyData)).resolves.toBe("fine");
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([300, 600]);
  });

  it("gives up after 2 retries with the last error", async () => {
    const { client, calls } = make([new Error("boom")]);
    const e = await client.get("/p", {}, anyData).catch((x) => x);
    expect(e).toMatchObject({ kind: "network" });
    expect(calls).toHaveLength(3);
  });

  it("retries 42900 (rate limit) with backoff; HTTP 429 body as recorded on 2026-10-02", async () => {
    const { client, calls } = make([
      body({ code: 42900, timestamp: 1790909367546, msg: "Rate limit exceeded", data: "" }, 429),
      ok("later"),
    ]);
    await expect(client.get("/p", {}, anyData)).resolves.toBe("later");
    expect(calls).toHaveLength(2);
  });

  it("flags non-JSON bodies and unexpected shapes instead of returning garbage", async () => {
    expect(
      await make([new Response("<html>bad gateway</html>", { status: 502 })], { retries: 0 })
        .client.get("/p", {}, anyData)
        .catch((x) => x),
    ).toMatchObject({ kind: "upstream" });
    expect(
      await make([body({ hello: "world" })])
        .client.get("/p", {}, anyData)
        .catch((x) => x),
    ).toMatchObject({
      kind: "unknown",
      message: expect.stringMatching(/unexpected response shape/),
    });
  });

  it("validates the data with the schema and reports the mismatch", async () => {
    const e = await make([ok({ n: "not-a-number" })])
      .client.get("/p", {}, z.object({ n: z.number() }))
      .catch((x) => x);
    expect(e).toBeInstanceOf(BinanceApiError);
    expect(e.message).toMatch(/did not match.*n/);
  });

  it("posts a JSON body that is exactly what was signed", async () => {
    const { client, calls } = make([ok(1)]);
    await client.post("/api/v1/dex/pre-transaction/simulate", { binanceChainId: "56" }, anyData);
    const { init } = calls[0]!;
    const h = init.headers as Record<string, string>;
    expect(init.body).toBe('{"binanceChainId":"56"}');
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["X-OC-SIGN"]).toBe(
      sign({
        secret: "test-secret",
        timestamp: h["X-OC-TIMESTAMP"]!,
        method: "POST",
        path: "/api/v1/dex/pre-transaction/simulate",
        body: '{"binanceChainId":"56"}',
      }),
    );
  });

  it("paces requests: a burst of 3, then ~4 per second (the API returned 42900 after ~5 calls in 50 ms)", async () => {
    const { client, sleeps, t } = make([ok(1)]);
    const start = t.v;
    await Promise.all(Array.from({ length: 8 }, () => client.get("/p", {}, anyData)));
    expect(sleeps.length).toBeGreaterThan(0);
    // 8 calls, 3 free, 5 more at 250 ms each ≈ 1.25 s of pacing
    expect(t.v - start).toBeGreaterThanOrEqual(1000);
    expect(t.v - start).toBeLessThan(1500);
  });
});
