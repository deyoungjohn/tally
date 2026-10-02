import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFixtureEngine } from "./engine";

/**
 * `pnpm tally quote NVDA 25 --json` run LIVE on the Seoul EC2 (real Binance API, real BSC RPC), 2026-10-02 05:44 UTC.
 * The fixture engine must agree with it on everything that is not a moving price.
 */
const live = JSON.parse(
  readFileSync(
    join(__dirname, "..", "fixtures", "live_quote_NVDA_25_20261002T054441Z.json"),
    "utf8",
  ),
);

describe("live Seoul run vs the fixture engine (exit check 1, live)", () => {
  it("the live run produced the full comparison with no warnings and no row errors", () => {
    expect(live.warnings).toEqual([]);
    expect(live.rows.map((r: { symbol: string }) => r.symbol).sort()).toEqual([
      "NVDAB",
      "NVDAon",
      "NVDAx",
    ]);
    expect(live.rows.every((r: { error?: unknown }) => !r.error)).toBe(true);
    expect(live.best).toBe("NVDAon");
  });

  it("same issuers executable, same multiplier sources, same winner and grades as the fixture engine", async () => {
    const fx = await createFixtureEngine().quote({ ticker: "NVDA", amount: { usd: 25 } });
    expect(fx.best).toBe(live.best);
    for (const l of live.rows) {
      const f = fx.rows.find((r) => r.symbol === l.symbol)!;
      expect(f.executable, l.symbol).toBe(l.executable);
      expect(f.multiplier?.source, l.symbol).toBe(l.multiplier.source);
      expect(f.multiplier?.disagree, l.symbol).toBe(l.multiplier.disagree);
      expect(f.integrity.grade, l.symbol).toBe(l.integrity.grade);
    }
  });

  it("prices agree to within a quote's normal movement (< 0.2% on $/share, < 0.3 points of premium)", async () => {
    const fx = await createFixtureEngine().quote({ ticker: "NVDA", amount: { usd: 25 } });
    for (const l of live.rows.filter((r: { executable: boolean }) => r.executable)) {
      const f = fx.rows.find((r) => r.symbol === l.symbol)!;
      expect(Math.abs(f.usdPerShare! / l.usdPerShare - 1), l.symbol).toBeLessThan(0.002);
      expect(Math.abs(f.premium! - l.premium) * 100, l.symbol).toBeLessThan(0.3);
    }
    expect(Math.abs(fx.referencePrice! / live.referencePrice - 1)).toBeLessThan(0.002);
  });

  it("live shares are tokens × multiplier, exactly (no rounding drift between sources)", () => {
    for (const l of live.rows.filter((r: { executable: boolean }) => r.executable)) {
      expect((BigInt(l.tokensOut) * BigInt(l.multiplier.value)) / 10n ** 18n).toBe(
        BigInt(l.sharesOut),
      );
    }
  });
});
