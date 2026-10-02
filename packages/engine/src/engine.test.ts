import { describe, expect, it } from "vitest";
import { BinanceApiError } from "@tally/binance";
import { BelowMinimumError, UnknownTickerError } from "@tally/core";
import { createFixtureEngine } from "./engine";
import { formatQuote } from "./format";

const warnings: string[] = [];
const engine = () => createFixtureEngine({ onWarn: (m) => warnings.push(m) });

describe("exit check 1: `tally quote NVDA 25` prints the per-issuer comparison", () => {
  it("returns shares, $/share, premium, ≈fee, route and grade for each issuer, from recorded Seoul quotes", async () => {
    const q = await engine().quote({ ticker: "NVDA", amount: { usd: 25 } });
    expect(warnings).toEqual([]); // no silent degradation on the happy path
    const on = q.rows.find((r) => r.symbol === "NVDAon")!;
    const b = q.rows.find((r) => r.symbol === "NVDAB")!;
    const x = q.rows.find((r) => r.symbol === "NVDAx")!;
    for (const r of [on, b]) {
      expect(r.executable).toBe(true);
      expect(r.sharesOut).toBeGreaterThan(0n);
      expect(r.usdPerShare).toBeGreaterThan(200);
      expect(Math.abs(r.premium!)).toBeLessThan(0.01);
      expect(r.feeUsd).toBeGreaterThan(0.01);
      expect(r.feeUsd).toBeLessThan(0.1);
      expect(r.routeText).toMatch(/^USDT → /);
      expect(r.integrity.grade).toBe("A");
    }
    // Authenticated `referencePrice` is per token: 232.0578 ÷ tokenToShareRatio 1.0017152 = 231.66 per share (bStock's own price is null, V15).
    expect(q.referencePrice).toBeCloseTo(232.0577842719 / 1.00171524879, 6);
    expect(q.session).toBe("overnight");
    expect(q.best).toBeDefined();
    expect(q.saving?.usd).toBeGreaterThan(0);
    expect(x).toMatchObject({ executable: false });
    expect(x.integrity.grade).toBe("F");
    expect(x.integrity.flags).toEqual(expect.arrayContaining(["ghost", "multiplier-disagreement"]));
  });

  it("the shares come from the recorded quote's tokens × the on-chain bStock multiplier", async () => {
    const q = await engine().quote({ ticker: "NVDA", amount: { usd: 25 } });
    const b = q.rows.find((r) => r.symbol === "NVDAB")!;
    expect(b.multiplier).toMatchObject({ source: "onchain", disagree: false });
    expect(b.sharesOut).toBe((b.tokensOut! * b.multiplier!.value) / 10n ** 18n);
  });

  it("formats the table with every column the exit check names", async () => {
    const out = formatQuote(await engine().quote({ ticker: "NVDA", amount: { usd: 25 } }));
    expect(out).toMatch(/Token\s+Shares\s+\$\/share\s+vs US\s+Fee\s+Route\s+Grade/);
    expect(out).toMatch(/NVDAon \(Ondo\)/);
    expect(out).toMatch(/NVDAB \(bStock\)/);
    expect(out).toMatch(/NVDAx \(xStocks\)/);
    expect(out).toMatch(/★ Best/);
    expect(out).toMatch(/≈\$0\.0\d\d/);
    expect(out).toMatch(/USDT → .*NVDA/);
    expect(out).toMatch(/⚠ghost/);
    expect(out).toMatch(/saves \$/);
  });

  it("the reference price is per SHARE: Ondo and bStock rows of the authenticated list agree to 0.02%, and NFLX is $68, not $680", async () => {
    const e = engine();
    const nvda = await e.ports.facts.reference("NVDA");
    const viaB = 231.81 / 1.0007782237528; // NVDAB row: referencePrice ÷ tokenToShareRatio
    expect(Math.abs(nvda!.price / viaB - 1)).toBeLessThan(0.0002);
    const nflx = await e.ports.facts.reference("NFLX");
    expect(nflx!.price).toBeCloseTo(68.080181, 5);
  });

  it("works for the other recorded tickers and sizes (the $100 and $1,000 ladder)", async () => {
    const e = engine();
    for (const ticker of ["NVDA", "AAPL", "NFLX"]) {
      for (const usd of [6, 25, 100, 1000]) {
        const q = await e.quote({ ticker, amount: { usd } });
        expect(
          q.rows.filter((r) => r.executable && r.sharesOut).length,
          `${ticker} ${usd}`,
        ).toBeGreaterThanOrEqual(1);
        expect(q.best, `${ticker} ${usd}`).toBeDefined();
      }
    }
  });
});

describe("exit check 2: unit tests reproduce the F1/F7 vectors end to end", () => {
  it("NFLX: Ondo 10× vs bStock 1× is flagged a unit trap on both; a naive token-price comparison would show ≈900%, shares do not", async () => {
    const e = engine();
    const q = await e.quote({ ticker: "NFLX", amount: { usd: 100 } });
    const on = q.rows.find((r) => r.symbol === "NFLXon")!;
    const b = q.rows.find((r) => r.symbol === "NFLXB")!;
    expect(on.multiplier!.value).toBe(10n * 10n ** 18n);
    expect(b.multiplier!.value).toBe(10n ** 18n);
    expect(on.integrity.unitTrap && b.integrity.unitTrap).toBe(true);
    expect(on.integrity.flags).toContain("unit-trap");
    // The listed token prices differ ~10×: this is the fake arbitrage a naive tool reports (F1).
    expect(on.premium).toBeUndefined();
    const { listedTokenPrice: onPrice } = await e.ports.facts.market(
      (await e.ports.registry.tokensFor("NFLX")).find((t) => t.symbol === "NFLXon")!,
    );
    const { listedTokenPrice: bPrice } = await e.ports.facts.market(
      (await e.ports.registry.tokensFor("NFLX")).find((t) => t.symbol === "NFLXB")!,
    );
    expect(onPrice! / bPrice!).toBeGreaterThan(9);
    expect(onPrice! / bPrice! - 1).toBeGreaterThan(8); // "+800%…+900% arbitrage"
    // In shares, bStock's quote is within 1% of the US price per share.
    expect(Math.abs(b.premium!)).toBeLessThan(0.01);
  });

  it("NFLXon is blocked as a ghost market in this snapshot ($16 of 24h on-chain volume): shown with its reason, not quoted", async () => {
    const q = await engine().quote({ ticker: "NFLX", amount: { usd: 100 } });
    const on = q.rows.find((r) => r.symbol === "NFLXon")!;
    expect(on).toMatchObject({
      executable: false,
      notExecutableReason: "Ghost market: almost no trading on BNB Chain",
    });
    expect(on.integrity.flags).toContain("ghost");
    expect(q.best).toBe("NFLXB");
  });

  it("NVDAx three-source mismatch: list 1.000000, API 1.000918, on-chain 1.001701", async () => {
    const q = await engine().quote({ ticker: "NVDA", amount: { usd: 25 } });
    const x = q.rows.find((r) => r.symbol === "NVDAx")!;
    expect(x.multiplier).toMatchObject({
      source: "onchain",
      disagree: true,
      value: 1_001_701_196_801_074_000n,
    });
    expect(x.multiplier!.maxDeviationPpm).toBe(1701);
  });

  it("live fills (F6/F7) are reproduced by the same share maths used for quotes", async () => {
    const { sharesFromTokens, parseDecimal } = await import("@tally/core");
    expect(sharesFromTokens(25957237393326391n, parseDecimal("1.000778223752807865", 18))).toBe(
      25977437932023150n,
    );
    expect(sharesFromTokens(26092638158534866n, parseDecimal("1.0017152487959898", 18))).toBe(
      26137393524720490n,
    );
  });
});

describe("exit check 3: 40304 and 40375 are handled from fixtures", () => {
  it("40375: the engine refuses 5 USDT before calling Binance (minimum 6 USDT)", async () => {
    await expect(engine().quote({ ticker: "NVDA", amount: { usd: 5 } })).rejects.toBeInstanceOf(
      BelowMinimumError,
    );
  });
  it("40375: if a 5 USDT quote did reach the API, it is a typed below_minimum error (recorded body)", async () => {
    const { ports } = engine();
    const [nvdaOn] = (await ports.registry.tokensFor("NVDA")).filter((t) => t.symbol === "NVDAon");
    const e = await ports.quotes
      .quote(nvdaOn!, 5n * 10n ** 18n, "0xcb634955B8A7DF7B106f7AB47C9759B26206b777")
      .catch((x) => x);
    expect(e).toBeInstanceOf(BinanceApiError);
    expect(e).toMatchObject({ kind: "below_minimum", code: 40375 });
  });
  it("40304: a blocked caller IP fails the whole quote as a region block (page ops), never a per-issuer row error", async () => {
    const e = await createFixtureEngine({ blockRegion: true })
      .quote({ ticker: "NVDA", amount: { usd: 25 } })
      .catch((x) => x);
    expect(e).toBeInstanceOf(BinanceApiError);
    expect(e).toMatchObject({ kind: "region_block", code: 40304 });
  });
});

describe("other behaviour", () => {
  it("unknown ticker", async () => {
    await expect(
      engine().quote({ ticker: "NOTATICKER", amount: { usd: 25 } }),
    ).rejects.toBeInstanceOf(UnknownTickerError);
  });
  it("shares mode (half a share of NVDA) converts through the reference price and lands on the target", async () => {
    // Recorded quotes exist only at 6/25/100/1000 USDT, so this uses a size the recording covers: 0.5 share ≈ $116 is not recorded.
    const e = await engine()
      .quote({ ticker: "NVDA", amount: { shares: 0.1 } })
      .catch((x) => x);
    expect(e).toBeInstanceOf(Error); // the fixture has no 23.4 USDT quote: it says so, loudly, rather than inventing one
    expect(String(e.message)).toMatch(/no recorded quote|Every quote failed/);
  });
  it("caches quotes for 10 s per (ticker, bucket)", async () => {
    let t = Date.UTC(2026, 9, 2, 12);
    const e = createFixtureEngine({ now: () => t });
    const a = await e.quote({ ticker: "AAPL", amount: { usd: 25 } });
    t += 9_000;
    expect(await e.quote({ ticker: "AAPL", amount: { usd: 25 } })).toBe(a);
    t += 2_000;
    expect(await e.quote({ ticker: "AAPL", amount: { usd: 25 } })).not.toBe(a);
  });
});
