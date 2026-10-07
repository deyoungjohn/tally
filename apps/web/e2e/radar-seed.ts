/**
 * Seeds an isolated TALLY_DATA_DIR with Radar and flow snapshots for the Radar view-model e2e (run through tsx, never in
 * production). It writes through the same store the app reads and uses recorded-style values only.
 */
import { gradeIntegrity } from "@tally/core";
import { openStore } from "@tally/modkit";
import type { FlowSnapshot, FlowToken } from "@tally/mod-flow";
import type { RadarGradeSnapshot } from "../modules/flow/view-model";

const E18 = 10n ** 18n;
const token = (
  ticker: string,
  symbol: string,
  issuer: FlowToken["issuer"],
  address: string,
): FlowToken => ({ ticker, symbol, issuer, address, multiplier: E18 });

const NVDA_ON = token("NVDA", "NVDAon", "ondo", "0xa9ee28c80f960b889dfbd1902055218cba016f75");
const NVDA_X = token("NVDA", "NVDAx", "xstocks", "0x0000000000000000000000000000000000001001");
const TSLA_B = token("TSLA", "TSLAB", "bstock", "0x0000000000000000000000000000000000001002");

async function main() {
  if (!process.env.TALLY_DATA_DIR) throw new Error("radar-seed needs an isolated TALLY_DATA_DIR");
  const store = openStore();
  const now = Date.now();
  const grade = (
    t: FlowToken,
    volume: number,
    over: Partial<RadarGradeSnapshot> = {},
  ): RadarGradeSnapshot => {
    const integrity = gradeIntegrity({
      session: "closed",
      status: null,
      now,
      unitTrap: false,
      onchainVolume24hUsd: volume,
    });
    return {
      ticker: t.ticker,
      address: t.address,
      symbol: t.symbol,
      issuer: t.issuer,
      score: integrity.score,
      grade: integrity.grade,
      reasons: integrity.reasons.map((r) => r.reason ?? r.summary),
      ghost: integrity.flags.includes("ghost"),
      integrity,
      rawVolume24hUsd: BigInt(Math.round(volume)) * E18,
      flowActive: false,
      flowReason: "Cleaned flow is not collected for this token",
      ...over,
    };
  };
  try {
    const tokens = [NVDA_ON, NVDA_X, TSLA_B];
    store.put({
      kind: "radar-registry",
      key: "bsc",
      source: "engine",
      observedAt: now,
      data: tokens,
    });
    store.put({
      kind: "flow-registry",
      key: "bsc",
      source: "engine",
      observedAt: now,
      data: [NVDA_ON],
    });
    // Healthy and flowing: graded on cleaned flow.
    store.put({
      kind: "radar",
      key: NVDA_ON.address,
      source: "engine",
      observedAt: now - 60_000,
      data: grade(NVDA_ON, 250_000, { flowActive: true, flowReason: null }),
    });
    const flow: FlowSnapshot = {
      token: NVDA_ON,
      trades: [
        {
          id: "c3-1",
          txHash: `0x${"c3".repeat(32)}`,
          wallet: "0x00000000000000000000000000000000000000a1",
          side: "buy",
          shares: 6n * E18,
          usd: 1400n * E18,
          pricePerShare: 233n * E18,
          priceReason: null,
          source: "binance" as const,
          at: now - 20 * 60_000,
        },
        {
          id: "d4-1",
          txHash: `0x${"d4".repeat(32)}`,
          wallet: "0x00000000000000000000000000000000000000a2",
          side: "sell",
          shares: 1n * E18,
          usd: 233n * E18,
          pricePerShare: 233n * E18,
          priceReason: null,
          source: "binance" as const,
          at: now - 10 * 60_000,
        },
      ],
      labels: {},
      holders: null,
      holdersReason: "Holder list unavailable",
      coverageStartMs: now - 7 * 86_400_000,
      notes: [],
    };
    store.put({
      kind: "flow",
      key: NVDA_ON.address,
      source: "binance",
      observedAt: now - 60_000,
      data: flow,
    });
    // A ghost market (under $1,000 in 24h).
    store.put({
      kind: "radar",
      key: NVDA_X.address,
      source: "engine",
      observedAt: now - 60_000,
      data: grade(NVDA_X, 16),
    });
    // Old enough to be stale (older than the one-hour grade freshness window).
    store.put({
      kind: "radar",
      key: TSLA_B.address,
      source: "engine",
      observedAt: now - 3 * 3_600_000,
      data: grade(TSLA_B, 9_000),
    });
    store.health.report("flow", { ok: true, now, intervalMs: 300_000 });
  } finally {
    store.close();
  }
}
main().catch((e) => {
  console.error("radar seed failed", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
