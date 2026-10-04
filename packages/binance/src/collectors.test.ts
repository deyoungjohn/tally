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
  it("portfolio endpoints parse from recorded probe fixtures through the signed client", async () => {
    const wallet = "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930";
    const token = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436";
    const client = api();

    // 1. recentPnl
    const recent = await client.recentPnl(wallet);
    expect(recent.pnlList.length).toBeGreaterThan(0);
    expect(recent.pnlList[0]?.tokenContractAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // 2. dexHistory
    const history = await client.dexHistory(wallet);
    expect(history.transactionList.length).toBeGreaterThan(0);
    expect(history.transactionList[0]?.txHash).toMatch(/^0x/);

    // 3. portfolioOverview
    const overview = await client.portfolioOverview(wallet);
    expect(overview.realizedPnlUsd).toBeDefined();

    // 4. tokenLatestPnl
    const tokenPnl = await client.tokenLatestPnl(wallet, token);
    expect(tokenPnl.realizedPnlUsd).toBeDefined();
    expect(tokenPnl.buyAvgPrice).toBeDefined();

    // Rejects invalid wallet address before requesting
    expect(() => client.recentPnl("invalid")).toThrow();
  });
});

it("flow collectors validate all four recorded tokens and send cursor/limit through the signed client", async () => {
  const tokens = [
    "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
    "0xa9ee28c80f960b889dfbd1902055218cba016f75",
    "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a",
    "0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4",
  ];
  const fetch = vi.fn(createCollectorFixtureFetch(createFixtureFetch())),
    client = api(fetch);
  for (const token of tokens) {
    expect((await client.trades(token)).trades.length).toBeGreaterThan(0);
    expect((await client.holders(token)).length).toBeGreaterThan(0);
    expect((await client.topTraders(token)).length).toBeGreaterThan(0);
    expect((await client.topLiquidity(token)).length).toBeGreaterThan(0);
  }
  expect(() => client.trades(tokens[0]!, undefined, 101)).toThrow("1..100");
  expect(() => client.trades(tokens[0]!, undefined, 0)).toThrow("1..100");
  expect(() => client.trades("invalid")).toThrow();
  const page = await client.trades(tokens[0]!);
  await expect(client.trades(tokens[0]!, page.cursor!)).rejects.toThrow("history is incomplete");
  expect((await client.trades(tokens[0]!, undefined, 10)).trades).toHaveLength(10);
  const request = new URL(String(fetch.mock.calls.at(-1)![0]));
  expect(request.searchParams.get("limit")).toBe("10");
  expect(request.searchParams.get("binanceChainId")).toBe("56");
});
