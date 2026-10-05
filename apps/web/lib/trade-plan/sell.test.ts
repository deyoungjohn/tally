import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "@tally/core";
import type { SellPlan } from "@tally/engine";
import { createSellIntent, emitSellStage, fetchSellPlan } from "./sell";

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

  it("emitSellStage dispatches stages to local listener", () => {
    const intent = createSellIntent(
      "NVDA",
      "bstock",
      NVDAB,
      USER,
      25654736000000000n,
      5940000000000000000n,
    );

    const stages: string[] = [];
    const listener = vi.fn((stage) => {
      stages.push(stage);
    });

    emitSellStage(intent, "intent", { listener });
    expect(stages).toContain("intent");

    const mockPlan = {
      ticker: "NVDA",
      issuer: "bstock" as const,
      symbol: "NVDAB",
      stock: NVDAB,
      user: USER,
      quotedUsdtOut: "6000000000000000000",
      sharesIn: "25674701000000000",
      multiplier: "1000778223752807865",
      usdPerShare: 233.8,
      referencePrice: 233.9,
      routeText: "NVDAB → USDT",
      hops: 1,
      vendor: "Elfomofi",
      builtAt: 1000,
      expiresAt: 16000,
      warnings: [],
      simulation: { ethCall: "ok" as const, binance: "ok" as const },
    } as unknown as SellPlan;

    emitSellStage(intent, "quote", { plan: mockPlan, listener });
    expect(stages).toContain("quote");

    emitSellStage(intent, "simulation", { plan: mockPlan, listener });
    expect(stages).toContain("simulation");

    emitSellStage(intent, "signed", { txHash: "0x123", listener });
    expect(stages).toContain("signed");

    emitSellStage(intent, "realized", { txHash: "0x123", status: "success", listener });
    expect(stages).toContain("realized");
  });
});
