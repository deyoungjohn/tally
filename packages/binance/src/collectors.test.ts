import { describe, expect, it, vi } from "vitest";
import { BinanceClient } from "./client";
import { BinanceCollectors } from "./collectors";
import {
  collectorRecording,
  createCollectorFixtureFetch,
  recordedLegacyRwaList,
} from "./collector-fixtures";
import { createFixtureFetch } from "./fixtures";
import { rwaTokensResponse } from "./schemas";

function api(fetch = createCollectorFixtureFetch(createFixtureFetch())) {
  return new BinanceCollectors(
    new BinanceClient({
      apiKey: "fixture",
      apiSecret: "fixture",
      fetch,
      ratePerSec: 10_000,
      burst: 10_000,
      sleep: async () => {},
    }),
  );
}

describe("additive collector endpoints", () => {
  it("both October 3 lists and the existing October 2 list parse including nullable bStock status", async () => {
    expect(rwaTokensResponse.parse(recordedLegacyRwaList())).toHaveLength(488);
    const list = await api().registry("bstock");
    expect(list).toHaveLength(46);
    expect(list.every((t) => t.statusInfo?.marketStatus === null)).toBe(true);
    expect(await api().registry()).toHaveLength(488);
    expect((await api().registry("ondo")).every((row) => row.platformId === "ondo")).toBe(true);
  });
  it("P_rwa_price_batch parses through the signed client, sends chain 56 and comma-separated addresses", async () => {
    const recorded = collectorRecording("P_rwa_price_batch").data as {
      tokenContractAddress: string;
    }[];
    const addresses = recorded.map((r) => r.tokenContractAddress);
    const fixture = createCollectorFixtureFetch(createFixtureFetch());
    const fetch = vi.fn(fixture);
    expect(await api(fetch).prices(addresses)).toEqual(recorded);
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/build/api/v1/dex/market/rwa/price");
    expect(url.searchParams.get("binanceChainId")).toBe("56");
    expect(url.searchParams.get("tokenContractAddresses")).toBe(addresses.join(","));
    expect(fetch.mock.calls[0]?.[1]?.headers).toHaveProperty("X-OC-SIGN");
  });
  it("rejects over 100 and malformed addresses before requesting; empty batches need no request", async () => {
    const fetch = vi.fn(createFixtureFetch());
    const client = api(fetch);
    expect(() => client.prices(Array(101).fill(`0x${"1".repeat(40)}`))).toThrow("at most 100");
    expect(() => client.prices(["invalid"])).toThrow();
    expect(await client.prices([])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("HTTP-200 region errors and schema errors are rejected; the existing client retries rate limits", async () => {
    const recorded = collectorRecording("P_rwa_price_batch").data as {
      tokenContractAddress: string;
    }[];
    const addresses = recorded.map((r) => r.tokenContractAddress);
    const blocked: typeof fetch = async () =>
      new Response(JSON.stringify({ code: 40304, msg: "blocked", data: null }));
    await expect(api(blocked).prices(addresses)).rejects.toMatchObject({
      kind: "region_block",
      http: 200,
    });
    const malformed: typeof fetch = async () =>
      new Response(JSON.stringify({ code: 0, data: [{ ...recorded[0], tokenPrice: "bad" }] }));
    await expect(api(malformed).prices(addresses)).rejects.toThrow("expected shape");
    let calls = 0;
    const transient: typeof fetch = async () =>
      new Response(
        JSON.stringify(
          ++calls === 1 ? { code: 42900, msg: "limited" } : { code: 0, data: recorded },
        ),
      );
    expect(await api(transient).prices(addresses)).toEqual(recorded);
    expect(calls).toBe(2);
  });
});
