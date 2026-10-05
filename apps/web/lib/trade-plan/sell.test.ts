import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "@tally/core";
import type { SellPlan } from "@tally/engine";
import { createSellIntent, emitSellStage, fetchSellPlan, postSellReceiptHint } from "./sell";

type Hex = `0x${string}`;

const USER = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7" as Address;
const NVDAB = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436" as Address;

describe("sell trade-plan client helper", () => {
  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = globalThis;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("creates a well-formed SellIntent", () => {
    const intent = createSellIntent(
      "NVDA",
      "bstock",
      NVDAB,
      USER,
      25654736000000000n,
      5940000000000000000n,
      1,
    );
    expect(intent.kind).toBe("sell");
    expect(intent.ticker).toBe("NVDA");
    expect(intent.issuer).toBe("bstock");
    expect(intent.stock).toBe(NVDAB);
    expect(intent.user).toBe(USER);
    expect(intent.tokensIn).toBe(25654736000000000n);
    expect(intent.minUsdtOut).toBe(5940000000000000000n);
    expect(typeof intent.id).toBe("string");
    expect(intent.id.length).toBeGreaterThan(10);
  });

  it("fetchSellPlan sends POST request and returns plan", async () => {
    const mockPlan: Partial<SellPlan> = {
      status: "ready",
      ticker: "NVDA",
      issuer: "bstock",
      quotedUsdtOut: "6000000000000000000",
      minUsdtOut: "5940000000000000000",
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockPlan,
    });

    const res = await fetchSellPlan({
      ticker: "NVDA",
      issuer: "bstock",
      shares: 0.025,
      user: USER,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/trade/sell", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ticker: "NVDA",
        issuer: "bstock",
        shares: 0.025,
        user: USER,
      }),
    });
    expect(res).toEqual(mockPlan);
  });

  it("fetchSellPlan throws on HTTP error response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: { kind: "not_buyable", message: "Token cannot be sold." } }),
    });

    await expect(
      fetchSellPlan({
        ticker: "NVDA",
        issuer: "bstock",
        shares: 0.025,
        user: USER,
        fetchFn: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Token cannot be sold.");
  });

  it("emitSellStage does not dispatch buy-shaped events to receipts", () => {
    const intent = createSellIntent(
      "NVDA",
      "bstock",
      NVDAB,
      USER,
      25654736000000000n,
      5940000000000000000n,
    );

    const listener = vi.fn();
    emitSellStage(intent, "intent", { listener });
    emitSellStage(intent, "quote", { listener });
    emitSellStage(intent, "signed", { txHash: "0x123", listener });
    expect(listener).not.toHaveBeenCalled();
  });

  it("postSellReceiptHint posts sell hint to /api/receipts with correct shape", async () => {
    const intent = createSellIntent(
      "NVDA",
      "bstock",
      NVDAB,
      USER,
      25654736000000000n,
      5940000000000000000n,
    );

    const mockPlan = {
      ticker: "NVDA",
      issuer: "bstock" as const,
      symbol: "NVDAB",
      stock: NVDAB,
      user: USER,
      quotedUsdtOut: "6000000000000000000",
      minUsdtOut: "5940000000000000000",
      tokensIn: "25654736000000000",
      routeText: "NVDAB → USDT",
      hops: 1,
      builtAt: 1000,
      expiresAt: 16000,
    } as unknown as SellPlan;

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const txHash = "0x" + "a".repeat(64);

    postSellReceiptHint({
      intent,
      txHash: txHash as Hex,
      plan: mockPlan,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        kind: "sell",
        txHash,
        intentId: intent.id,
        attempt: 1,
        user: USER,
        ticker: "NVDA",
        isResumed: false,
        quote: {
          stock: NVDAB,
          issuer: "bstock",
          tokensIn: "25654736000000000",
          minUsdtOut: "5940000000000000000",
          quotedUsdtOut: "6000000000000000000",
          hops: 1,
          routeText: "NVDAB → USDT",
          builtAt: 1000,
          expiresAt: 16000,
        },
        simulation: null,
      }),
    });
  });

  it("postSellReceiptHint is fire-and-forget and does not throw on network failure", () => {
    const intent = createSellIntent(
      "NVDA",
      "bstock",
      NVDAB,
      USER,
      25654736000000000n,
      5940000000000000000n,
    );

    const rejectingFetch = vi.fn().mockRejectedValue(new Error("Network offline"));
    expect(() => {
      postSellReceiptHint({
        intent,
        txHash: ("0x" + "b".repeat(64)) as Hex,
        fetchFn: rejectingFetch as unknown as typeof fetch,
      });
    }).not.toThrow();
  });
});
