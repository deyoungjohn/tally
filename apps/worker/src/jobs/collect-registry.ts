import { collectorRecording } from "@tally/binance";
import { collect } from "../collect";
import type { WorkerJob } from "../runner";

export const job: WorkerJob = {
  name: "collect-registry",
  intervalMs: 60_000,
  async run(ctx) {
    await collect(ctx, "registry", "bsc", 60_000, async () => {
      const data = (await ctx.engine.collectors.registry()).filter(
        (row) => row.binanceChainId === "56",
      );
      if (!data.length) throw new Error("RWA registry returned no BSC tokens");
      const fixture =
        process.env.TALLY_FIXTURES === "1" ? collectorRecording("G_rwa_tokens_earnings") : null;
      return {
        kind: "registry",
        key: "bsc",
        data,
        source: fixture?.source ?? "binance:rwa/tokens",
        observedAt: fixture?.observedAt ?? ctx.now(),
        notes: [
          "Authenticated RWA list is truncated and excludes xStocks; this snapshot is not the complete executable registry.",
        ],
      };
    });
  },
};
