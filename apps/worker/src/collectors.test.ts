import { afterEach, expect, it, vi } from "vitest";
import { createFixtureEngine } from "@tally/engine";
import { collectorRecording, type RwaPrice } from "@tally/binance";
import { openStore } from "@tally/modkit";
import { job as registryJob } from "./jobs/collect-registry";
import { job as pricesJob } from "./jobs/collect-prices";

afterEach(() => vi.unstubAllEnvs());

it("fixture collector jobs write recorded registry/status and prices with original observation times and missing-price reasons", async () => {
  vi.stubEnv("TALLY_FIXTURES", "1");
  const store = openStore(":memory:");
  const onWarn = vi.fn();
  const ctx = {
    store,
    health: store.health,
    engine: createFixtureEngine(),
    now: () => collectorRecording("G_rwa_tokens_earnings").observedAt,
    onWarn,
  };
  try {
    await registryJob.run(ctx);
    const registry = store.latest("registry", "bsc", { maxAgeMs: 60_000 });
    expect(registry).toMatchObject({
      observedAt: collectorRecording("G_rwa_tokens_earnings").observedAt,
      source: expect.stringContaining("fixture:"),
      notes: [expect.stringContaining("truncated")],
    });
    await pricesJob.run(ctx);
    const prices = store.latest<RwaPrice[]>("prices", "bsc", { maxAgeMs: 15_000 });
    // The truncated registry omits AAPLB even though its price was recorded separately.
    expect(prices?.data.map((r) => r.platformId)).toEqual(["bstock", "ondo", "ondo"]);
    expect(prices?.notes?.join()).toContain("omitted by rwa/price");
    for (const row of prices!.data)
      expect(
        store.latest("price", row.tokenContractAddress, { maxAgeMs: 15_000 })?.observedAt,
      ).toBe(row.tokenPriceUpdatedAt);
    // Replaying an unchanged poll must not add a registry, batch, or per-token row.
    await registryJob.run(ctx);
    await pricesJob.run(ctx);
    expect(store.history("registry", "bsc", 0)).toHaveLength(1);
    expect(store.history("prices", "bsc", 0)).toHaveLength(1);
    for (const row of prices!.data)
      expect(store.history("price", row.tokenContractAddress, 0)).toHaveLength(1);
    expect(onWarn).toHaveBeenCalled();
  } finally {
    store.close();
  }
});

it("price collection without a registry explains why it cannot run", async () => {
  const store = openStore(":memory:");
  try {
    await expect(
      pricesJob.run({
        store,
        health: store.health,
        engine: createFixtureEngine(),
        now: Date.now,
        onWarn: vi.fn(),
      }),
    ).rejects.toThrow("start collect-registry first");
  } finally {
    store.close();
  }
});
