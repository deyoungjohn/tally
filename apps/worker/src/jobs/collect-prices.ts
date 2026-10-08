import { collectorRecording, type RwaToken } from "@tally/binance";
import { collect } from "../collect";
import type { WorkerJob } from "../runner";

export const job: WorkerJob = {
  name: "collect-prices",
  intervalMs: 15_000,
  async run(ctx) {
    const registry = ctx.store.latest<RwaToken[]>("registry", "bsc", {
      maxAgeMs: 60_000,
      now: ctx.now(),
    });
    if (!registry) throw new Error("No registry snapshot; start collect-registry first");
    if (registry.stale)
      ctx.onWarn(`Using stale registry (${registry.ageMs} ms old) to poll known addresses`);
    const addresses = [...new Set(registry.data.map((r) => r.tokenContractAddress.toLowerCase()))];
    await collect(ctx, "prices", "bsc", 15_000, async () => {
      const data = [];
      for (let offset = 0; offset < addresses.length; offset += 20) {
        data.push(...(await ctx.engine.collectors.prices(addresses.slice(offset, offset + 20))));
      }
      if (!data.length) throw new Error("RWA price batch returned no prices");
      const received = new Set(data.map((r) => r.tokenContractAddress.toLowerCase()));
      const notes = addresses
        .filter((a) => !received.has(a))
        .map((a) => `Price unavailable for ${a}: omitted by rwa/price`);
      if (registry.stale) notes.push(`Registry snapshot is stale (${registry.ageMs} ms old)`);
      for (const note of notes) ctx.onWarn(note);
      const fixture =
        process.env.TALLY_FIXTURES === "1" ? collectorRecording("P_rwa_price_batch") : null;
      const source = fixture?.source ?? "binance:rwa/price";
      for (const row of data) {
        ctx.store.put({
          kind: "price",
          key: row.tokenContractAddress.toLowerCase(),
          data: row,
          source,
          observedAt: row.tokenPriceUpdatedAt,
          notes: registry.stale ? ["Registry snapshot is stale"] : undefined,
        });
      }
      return {
        kind: "prices",
        key: "bsc",
        data,
        source,
        observedAt: Math.min(...data.map((r) => r.tokenPriceUpdatedAt)),
        notes,
      };
    });
  },
};
