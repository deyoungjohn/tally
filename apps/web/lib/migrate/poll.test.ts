import { describe, expect, it, vi } from "vitest";
import { fetchSaleStatus } from "./poll";

describe("fetchSaleStatus (poll-state)", () => {
  const HASH = "0x" + "a".repeat(64);
  const now = 1000000;
  const startMs = now - 10000; // 10s elapsed

  it("completes through the chain route when the receipts worker is stopped (500)", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/api/trade/sale-proceeds")) {
        return {
          ok: true,
          json: async () => ({
            state: "confirmed",
            usdtReceivedRaw: "6990000000000000000",
            tokensSpentRaw: "2500000000000000000",
            stockToken: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
            blockNumber: 123456,
          }),
        } as Response;
      }
      if (url.includes("/api/receipts")) {
        return {
          ok: false,
          status: 500,
        } as Response;
      }
      throw new Error(`Unhandled url ${url}`);
    });

    const res = await fetchSaleStatus(HASH, startMs, true, fetchFn as unknown as typeof fetch, now);
    expect(res).toEqual({
      state: "confirmed",
      usdtReceivedRaw: "6990000000000000000",
      source: "chain",
      fixture: false,
    });
    // Receipts worker was not even needed or called after chain confirmed
  });

  it("completes through the chain route when the receipts worker returns 404", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/api/trade/sale-proceeds")) {
        return {
          ok: true,
          json: async () => ({
            state: "confirmed",
            usdtReceivedRaw: "7000000000000000000",
            tokensSpentRaw: "2500000000000000000",
            stockToken: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
            blockNumber: 123456,
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const res = await fetchSaleStatus(HASH, startMs, true, fetchFn as unknown as typeof fetch, now);
    expect(res).toEqual({
      state: "confirmed",
      usdtReceivedRaw: "7000000000000000000",
      source: "chain",
      fixture: false,
    });
  });

  it("completes through chain route when receipts feature flag is disabled", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/api/trade/sale-proceeds")) {
        return {
          ok: true,
          json: async () => ({
            state: "confirmed",
            usdtReceivedRaw: "8000000000000000000",
          }),
        } as Response;
      }
      throw new Error("Should not fetch receipts when disabled");
    });

    const res = await fetchSaleStatus(
      HASH,
      startMs,
      false,
      fetchFn as unknown as typeof fetch,
      now,
    );
    expect(res).toEqual({
      state: "confirmed",
      usdtReceivedRaw: "8000000000000000000",
      source: "chain",
      fixture: false,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns failed when chain indicates reverted transaction", async () => {
    const fetchFn = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ state: "failed" }),
      } as Response;
    });

    const res = await fetchSaleStatus(HASH, startMs, true, fetchFn as unknown as typeof fetch, now);
    expect(res).toEqual({ state: "failed" });
  });

  it("returns unrecognised when chain sale does not look like stock-for-USDT", async () => {
    const fetchFn = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ state: "unrecognised" }),
      } as Response;
    });

    const res = await fetchSaleStatus(HASH, startMs, true, fetchFn as unknown as typeof fetch, now);
    expect(res).toEqual({ state: "unrecognised" });
  });

  it("returns underMinimum when proceeds are below the 6 USDT minimum", async () => {
    const fetchFn = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          state: "confirmed",
          usdtReceivedRaw: "5990000000000000000", // 5.99 USDT
        }),
      } as Response;
    });

    const res = await fetchSaleStatus(HASH, startMs, true, fetchFn as unknown as typeof fetch, now);
    expect(res).toEqual({
      state: "underMinimum",
      usdtReceivedRaw: "5990000000000000000",
      source: "chain",
      fixture: false,
    });
  });

  it("propagates fixture: true from fixture mode response", async () => {
    const fetchFn = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          state: "confirmed",
          usdtReceivedRaw: "3500000000000000000000",
          fixture: true,
        }),
      } as Response;
    });

    const res = await fetchSaleStatus(HASH, startMs, true, fetchFn as unknown as typeof fetch, now);
    expect(res).toEqual({
      state: "confirmed",
      usdtReceivedRaw: "3500000000000000000000",
      source: "chain",
      fixture: true,
    });
  });

  it("returns pending when chain is pending and receipts worker is offline/unreconciled (< 120s)", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/api/trade/sale-proceeds")) {
        return {
          ok: true,
          json: async () => ({ state: "pending" }),
        } as Response;
      }
      return {
        ok: false,
        status: 500,
      } as Response;
    });

    const res = await fetchSaleStatus(HASH, startMs, true, fetchFn as unknown as typeof fetch, now);
    expect(res).toEqual({ state: "pending" });
  });

  it("returns timeout when chain is pending and time exceeds 120s", async () => {
    const timedOutStart = now - 125000; // 125s elapsed
    const fetchFn = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ state: "pending" }),
      } as Response;
    });

    const res = await fetchSaleStatus(
      HASH,
      timedOutStart,
      true,
      fetchFn as unknown as typeof fetch,
      now,
    );
    expect(res).toEqual({ state: "timeout" });
  });

  it("handles chain 503 RPC failure gracefully by staying pending or timing out", async () => {
    const fetchFn = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
      } as Response;
    });

    const res1 = await fetchSaleStatus(
      HASH,
      startMs,
      true,
      fetchFn as unknown as typeof fetch,
      now,
    );
    expect(res1).toEqual({ state: "pending" });

    const timedOutStart = now - 125000;
    const res2 = await fetchSaleStatus(
      HASH,
      timedOutStart,
      true,
      fetchFn as unknown as typeof fetch,
      now,
    );
    expect(res2).toEqual({ state: "timeout" });
  });
});
