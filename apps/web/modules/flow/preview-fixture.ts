/** Offline preview seed. Run only against a dedicated temporary TALLY_DATA_DIR. */
import { gradeIntegrity } from "@tally/core";
import { openStore } from "@tally/modkit";
import { createFixtureEngine } from "../../../../packages/engine/src/engine";
import { fixed, type FlowToken } from "@tally/mod-flow";
import { collectFlow } from "../../../worker/src/jobs/collect-flow";
import type { RadarGradeSnapshot } from "./view-model";

async function seed() {
  if (!process.env.TALLY_DATA_DIR || process.env.TALLY_FIXTURES !== "1")
    throw new Error("Preview seed requires TALLY_DATA_DIR and TALLY_FIXTURES=1");
  const store = openStore(),
    now = Date.now();
  try {
    const engine = createFixtureEngine();
    engine.collectors.trades = async () => {
      throw new Error("Offline preview: primary API unavailable");
    };
    const tokens: FlowToken[] = [
      {
        ticker: "NVDA",
        symbol: "NVDAB",
        address: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
        issuer: "bstock",
        multiplier: fixed("1.000778223752807865"),
      },
      {
        ticker: "NVDA",
        symbol: "NVDAon",
        address: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
        issuer: "ondo",
        multiplier: fixed("1.0017152488"),
      },
    ];
    await collectFlow(
      { store, health: store.health, engine, onWarn: (m) => console.warn(m), now: () => now },
      { tokens, fixture: true },
    );
    store.put({
      kind: "flow-registry",
      key: "bsc",
      source: "fixture",
      observedAt: now,
      data: tokens,
    });
    for (const token of tokens)
      store.put<RadarGradeSnapshot>({
        kind: "radar",
        key: token.address,
        source: "fixture",
        observedAt: now,
        data: {
          ...token,
          score: 90,
          grade: "A",
          reasons: ["Recorded multiplier sources agree"],
          ghost: false,
          integrity: gradeIntegrity({
            session: "closed",
            status: null,
            now,
            unitTrap: false,
            onchainVolume24hUsd: 2000,
          }),
        },
      });
    store.health.report("flow", { ok: true, now });
  } finally {
    store.close();
  }
}
seed().catch(() => {
  console.error("Flow preview seed failed");
  process.exitCode = 1;
});
