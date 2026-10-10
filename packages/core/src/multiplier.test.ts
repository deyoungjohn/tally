import { describe, expect, it } from "vitest";
import {
  SIMPLE_RATIOS,
  checkOndoMultiplier,
  corporateActionKind,
  isUnitTrap,
  matchSimpleRatio,
  resolveMultiplier,
  sharesFromTokens,
  validateMultiplierAgainstPrice,
} from "./multiplier";
import { statusFromInfo } from "./status";
import { parseDecimal } from "./units";

const m = (s: string) => parseDecimal(s, 18);

describe("share maths: reproduces the live fills (IDEAS F6/F7)", () => {
  it("bStock fill: 0.025957237393326391 tokens × uiMultiplier = 0.02597743793202315 shares, 230.97 USDT per share", () => {
    const shares = sharesFromTokens(25957237393326391n, m("1.000778223752807865"));
    expect(shares).toBe(25977437932023150n); // exactly what the live script recorded
    expect(6 / (Number(shares) / 1e18)).toBeCloseTo(230.96965973706068, 9);
  });
  it("Ondo fill: 0.026092638158534866 tokens × 1.0017152487959898 = 0.02613739352472049 shares, 229.56 USDT per share, −0.12% vs 229.84", () => {
    const shares = sharesFromTokens(26092638158534866n, m("1.0017152487959898"));
    expect(shares).toBe(26137393524720490n);
    const perShare = 6 / (Number(shares) / 1e18);
    expect(perShare).toBeCloseTo(229.5561718625562, 9);
    expect((perShare / 229.84 - 1) * 100).toBeCloseTo(-0.12348944371902704, 9);
  });
});

describe("resolveMultiplier (blueprint §7.3)", () => {
  it("NVDAx three-source mismatch (IDEAS F1): list 1.000000, dynamic 1.000918, onchain 1.001701 → onchain wins, flagged", () => {
    const r = resolveMultiplier("xstocks", {
      list: m("1"),
      api: m("1.0009180758490996"),
      onchain: m("1.001701196801074"),
    })!;
    expect(r.source).toBe("onchain");
    expect(r.disagree).toBe(true);
    expect(r.maxDeviationPpm).toBe(1701); // 0.17%
    expect(r.degraded).toBe(false);
  });
  it("bStock onchain matches the API (38/38 in F1): no disagreement", () => {
    const r = resolveMultiplier("bstock", {
      onchain: m("1.0007782237528078"),
      api: m("1.000778223752807865"),
      list: m("1.000778223752807865"),
    })!;
    expect(r.disagree).toBe(false);
    expect(r.source).toBe("onchain");
  });
  it("Ondo has no onchain value: the API is the source", () => {
    const r = resolveMultiplier("ondo", { api: m("10") })!;
    expect(r).toMatchObject({ source: "api", degraded: false, disagree: false });
  });
  it("falls back and says so when the preferred source is missing", () => {
    const r = resolveMultiplier("bstock", { api: m("1.0008") })!;
    expect(r).toMatchObject({ source: "api", degraded: true });
  });
  it("returns null when no source answered or all are zero", () => {
    expect(resolveMultiplier("ondo", {})).toBeNull();
    expect(resolveMultiplier("ondo", { api: 0n })).toBeNull();
  });
});

describe("unit trap (F1: Ondo NFLX 10 shares per token vs bStock 1)", () => {
  it("flags a 10× difference, ignores dividend-sized differences", () => {
    expect(isUnitTrap(m("10"), [m("1")])).toBe(true);
    expect(isUnitTrap(m("1"), [m("10")])).toBe(true);
    expect(isUnitTrap(m("0.1017"), [m("1")])).toBe(true); // SOXS
    expect(isUnitTrap(m("1.0017"), [m("1.0007"), m("1")])).toBe(false);
    expect(isUnitTrap(m("1"), [])).toBe(false);
  });
});

describe("Ondo bounds (blueprint §7.3)", () => {
  const NOW = Date.UTC(2026, 9, 2, 12);
  const H = 3_600_000;
  const open = statusFromInfo({ openState: true, marketStatus: "regular", reasonCode: "TRADING" });
  const paused = statusFromInfo({
    marketStatus: "paused",
    reasonCode: "MARKET_PAUSED",
    reasonMsg: "stock_split",
  });
  const prev = (v: string) => ({ value: m(v), at: Date.UTC(2026, 8, 30) });
  const seen = (
    hoursBeforeNow: number,
    kind: "stock_split" | "stock_dividend" = "stock_split",
  ) => ({ kind, firstSeenAt: NOW - hoursBeforeNow * H, lastSeenAt: NOW - hoursBeforeNow * H });
  // price inputs consistent with a multiplier: token = stock × multiplier
  const px = (mult: string, stock: number, skew = 0) => ({
    stockPrice: stock,
    tokenPrice: stock * Number(mult) * (1 + skew),
  });
  const run = (
    o: Partial<Omit<Parameters<typeof checkOndoMultiplier>[0], "current" | "previous">> & {
      current: string;
      previous?: string;
    },
  ) => {
    const { current, previous, ...rest } = o;
    return checkOndoMultiplier({
      now: NOW,
      status: open,
      previous: previous ? prev(previous) : undefined,
      ...rest,
      current: m(current),
    });
  };

  it("an unchanged value passes and needs no price check", () => {
    const r = run({ current: "1.0017", previous: "1.0017" });
    expect(r).toMatchObject({ outcome: "pass" });
    expect(r.detail).toMatch(/unchanged/);
    expect(r.validation.outcome).toBe("not-needed");
  });

  describe("check 3: tokenPrice ÷ multiplier within 2% of the US share price, once trading has resumed", () => {
    it("passes when they agree: NFLXon on the real 2026-09-30 data, token $699.16 ÷ 10 = $69.92 vs stock $69.87", () => {
      const v = validateMultiplierAgainstPrice({
        multiplier: m("10"),
        tokenPrice: 699.1611,
        stockPrice: 69.8741,
        status: open,
      });
      expect(v.outcome).toBe("pass");
      expect(v.summary).toBe(
        "token $699.16 ÷ multiplier 10 = $69.92 per share vs stock $69.87: +0.06% (limit ±2%)",
      );
      expect(v.inputs).toMatchObject({
        tokenPrice: 699.1611,
        multiplier: "10",
        stockPrice: 69.8741,
        deviationPct: 0.06,
        status: "open",
      });
    });
    it("passes CRWDon on real data: $1061.38 ÷ 4 = $265.35 vs stock $265.32", () => {
      expect(
        validateMultiplierAgainstPrice({
          multiplier: m("4"),
          tokenPrice: 1061.384,
          stockPrice: 265.318333,
          status: open,
        }).outcome,
      ).toBe("pass");
    });
    it("fails when the multiplier is wrong: the xStocks NFLX token at $71.30 with a multiplier of 10 implies $7.13 per share, −89.8%", () => {
      const v = validateMultiplierAgainstPrice({
        multiplier: m("10"),
        tokenPrice: 71.3027,
        stockPrice: 69.8741,
        status: open,
      });
      expect(v.outcome).toBe("fail");
      expect(v.summary).toMatch(/-89\.80%/);
    });
    it("the limit is ±2%: 1.9% passes, 2.1% fails", () => {
      expect(
        validateMultiplierAgainstPrice({ multiplier: m("1"), ...px("1", 100, 0.019), status: open })
          .outcome,
      ).toBe("pass");
      expect(
        validateMultiplierAgainstPrice({ multiplier: m("1"), ...px("1", 100, 0.021), status: open })
          .outcome,
      ).toBe("fail");
    });
    it("waits (unavailable) until trading has resumed, and when inputs are missing", () => {
      expect(
        validateMultiplierAgainstPrice({ multiplier: m("10"), ...px("10", 70), status: paused })
          .summary,
      ).toMatch(/trading has not resumed \(status paused MARKET_PAUSED\)/);
      expect(
        validateMultiplierAgainstPrice({ multiplier: m("10"), ...px("10", 70), status: null })
          .outcome,
      ).toBe("unavailable");
      expect(
        validateMultiplierAgainstPrice({ multiplier: m("10"), stockPrice: 70, status: open })
          .summary,
      ).toMatch(/inputs missing \(token price none, stock price 70\)/);
    });
  });

  describe("dividend steps (≤ 3%): accepted on size, and the price check must not fail", () => {
    it("HYG +0.40% passes with a consistent price; the check's inputs are in the result", () => {
      const r = run({ previous: "1", current: "1.004", prices: px("1.004", 77.1) });
      expect(r.outcome).toBe("pass");
      expect(r.detail).toMatch(
        /within the 3% single-step limit; price check: token \$77\.41 ÷ multiplier 1\.004 = \$77\.10 per share vs stock \$77\.10/,
      );
      expect(r.validation.outcome).toBe("pass");
    });
    it("is accepted on size alone when the price check is unavailable (no prices, or trading not open)", () => {
      expect(run({ previous: "1", current: "1.0058" })).toMatchObject({
        outcome: "pass",
        validation: { outcome: "unavailable" },
      });
      expect(
        run({ previous: "1", current: "1.0058", status: paused, prices: px("1.0058", 50) }),
      ).toMatchObject({ outcome: "pass", validation: { outcome: "unavailable" } });
    });
    it("is BLOCKED when the price check runs and fails: the step is small, but the market disagrees by more than 2%", () => {
      const r = run({ previous: "1", current: "1.004", prices: px("1.004", 77.1, 0.05) });
      expect(r.outcome).toBe("fail");
      expect(r.detail).toMatch(/FAILED the price check/);
    });
    it("exactly 3% passes by size; above 3% needs all three", () => {
      expect(run({ previous: "1", current: "1.03" }).outcome).toBe("pass");
      expect(run({ previous: "1", current: "1.0301" }).outcome).toBe("fail");
    });
    it("there is no per-day cap: a step after years is still just a step", () => {
      expect(
        checkOndoMultiplier({
          now: NOW,
          status: open,
          current: m("1.0250"),
          previous: { value: m("1"), at: Date.UTC(2020, 0, 1) },
        }).outcome,
      ).toBe("pass");
    });
  });

  describe("decreases and jumps above 3%: accepted only when ALL THREE hold (status, simple ratio, price)", () => {
    // [name, old multiplier, new multiplier, stock price]. SOXS has no price data in the repo: its stock price is a stated assumption.
    const vectors: Array<[string, string, string, number]> = [
      ["NFLX 10.0 (a 10-for-1 split)", "1", "10", 69.87],
      ["CRWD 4.0 (a 4-for-1 split)", "1", "4", 265.32],
      ["SOXS 0.1017 (a 1-for-10 reverse split)", "1.017", "0.1017", 30],
    ];
    for (const [name, oldM, newM, stock] of vectors) {
      it(`${name}: passes with a stock_split seen, a simple ratio, and a consistent price`, () => {
        const r = run({ previous: oldM, current: newM, action: seen(6), prices: px(newM, stock) });
        expect(r.outcome).toBe("pass");
        expect(r.detail).toMatch(/accepted, all three hold/);
        expect(r.detail).toMatch(/\(1\) stock_split seen/);
        expect(r.detail).toMatch(/\(2\) new\/old = .*simple ratio/);
        expect(r.detail).toMatch(/\(3\) price check: token/);
      });
      it(`${name}: stays blocked without the status sighting`, () => {
        const r = run({ previous: oldM, current: newM, prices: px(newM, stock) });
        expect(r.outcome).toBe("fail");
        expect(r.detail).toMatch(
          /blocked until all three hold: \(1\) no stock_split\/stock_dividend status seen within 48h/,
        );
      });
      it(`${name}: stays blocked while trading has not resumed (check 3 waits)`, () => {
        const r = run({
          previous: oldM,
          current: newM,
          action: seen(6),
          status: paused,
          prices: px(newM, stock),
        });
        expect(r.outcome).toBe("fail");
        expect(r.detail).toMatch(/\(3\) price check: trading has not resumed/);
      });
      it(`${name}: stays blocked when the price disagrees by more than 2%`, () => {
        const r = run({
          previous: oldM,
          current: newM,
          action: seen(6),
          prices: px(newM, stock, 0.03),
        });
        expect(r.outcome).toBe("fail");
        expect(r.detail).toMatch(/\(3\) price check: token .* \+3\.00% \(limit ±2%\)/);
      });
    }
    it("stays blocked when the ratio is not simple: a drop to ×0.52 matches none of them", () => {
      const r = run({ previous: "1.0", current: "0.52", action: seen(6), prices: px("0.52", 50) });
      expect(r.outcome).toBe("fail");
      expect(r.detail).toMatch(/\(2\) new\/old = 0\.5200, no simple ratio within 0\.5%/);
    });
    it("a stock_dividend status justifies it just as a stock_split does", () => {
      expect(
        run({
          previous: "1",
          current: "1.5",
          action: seen(2, "stock_dividend"),
          prices: px("1.5", 80),
        }),
      ).toMatchObject({ outcome: "pass" }); // 3/2
    });
    it("a plain decrease with nothing around it is blocked and says why", () => {
      const r = run({ previous: "1.0017", current: "1.0010", prices: px("1.0010", 100) });
      expect(r.outcome).toBe("fail");
      expect(r.detail).toMatch(/-0\.070% decrease, blocked until all three hold/);
    });
    it("the status sighting must be within 48 h of the change (the change time is Binance's lastUpdateTime when known)", () => {
      const changedAt = NOW - 10 * 24 * H;
      expect(
        run({ previous: "1", current: "10", changedAt, action: seen(1), prices: px("10", 70) })
          .outcome,
      ).toBe("fail"); // seen now, changed 10 days ago
      expect(
        run({
          previous: "1",
          current: "10",
          changedAt,
          action: {
            kind: "stock_split",
            firstSeenAt: changedAt - 5 * H,
            lastSeenAt: changedAt + 3 * H,
          },
          prices: px("10", 70),
        }).outcome,
      ).toBe("pass");
      expect(
        run({
          previous: "1",
          current: "10",
          changedAt,
          action: {
            kind: "stock_split",
            firstSeenAt: changedAt + 49 * H,
            lastSeenAt: changedAt + 50 * H,
          },
          prices: px("10", 70),
        }).outcome,
      ).toBe("fail");
      expect(
        run({
          previous: "1",
          current: "10",
          changedAt,
          action: {
            kind: "stock_split",
            firstSeenAt: changedAt - 50 * H,
            lastSeenAt: changedAt - 49 * H,
          },
          prices: px("10", 70),
        }).outcome,
      ).toBe("fail");
    });
  });

  it("no baseline: skipped (only sanity checked), and zero or negative always fails", () => {
    const none = run({ current: "1.0017" });
    expect(none).toMatchObject({ outcome: "skipped" });
    expect(none.detail).toMatch(/no baseline/);
    expect(checkOndoMultiplier({ now: NOW, status: open, current: 0n })).toMatchObject({
      outcome: "fail",
    });
  });
  it("the detail line carries the numbers and the baseline date", () => {
    expect(run({ previous: "1.0017", current: "1.0200" }).detail).toMatch(
      /^1\.02 vs baseline 1\.0017 \(seen 2026-09-30\): \+1\.827%, within the 3% single-step limit/,
    );
  });
});

describe("simple ratios (n or 1/n for n in 2,3,4,5,8,10,15,20,25,30,50, plus 3/2 and 2/3, within 0.5%)", () => {
  const ratio = (a: string, b: string) => matchSimpleRatio(m(b), m(a));
  it("the table has exactly those 24 ratios", () => {
    expect(SIMPLE_RATIOS.map((r) => r.label)).toEqual(
      [2, 3, 4, 5, 8, 10, 15, 20, 25, 30, 50]
        .flatMap((n) => [String(n), `1/${n}`])
        .concat(["3/2", "2/3"]),
    );
  });
  it("every ratio matches itself exactly, forward and reverse", () => {
    for (const n of [2, 3, 4, 5, 8, 10, 15, 20, 25, 30, 50]) {
      expect(ratio("1", String(n))?.label, `×${n}`).toBe(String(n));
      expect(ratio(String(n), "1")?.label, `÷${n}`).toBe(`1/${n}`);
    }
    expect(ratio("1", "1.5")?.label).toBe("3/2");
    expect(ratio("3", "2")?.label).toBe("2/3");
  });
  it("tolerates up to 0.5% (dividends accrued across the split) and rejects more", () => {
    expect(ratio("1", "10.05")).toBeDefined(); // +0.50%
    expect(ratio("1", "10.06")).toBeUndefined(); // +0.60%
    expect(ratio("1.017", "0.1017")?.label).toBe("1/10");
    expect(ratio("1.0170", "0.101695663086635307")?.label).toBe("1/10"); // SOXSon as listed
  });
  it("non-ratios: 6, 7, 12, 0.4 and ordinary dividend steps match nothing", () => {
    for (const v of ["6", "7", "12", "0.4", "1.004", "1.0058", "0.99"])
      expect(ratio("1", v), v).toBeUndefined();
  });
});

describe("corporateActionKind: the reasonMsg is a bare code, no ratio is read from it", () => {
  it("recognises the codes, in any case", () => {
    expect(corporateActionKind("stock_split")).toBe("stock_split");
    expect(corporateActionKind("STOCK_DIVIDEND")).toBe("stock_dividend");
  });
  it("ignores everything else, and a ratio in the text is not parsed", () => {
    expect(corporateActionKind("Paused for session transition")).toBeUndefined();
    expect(corporateActionKind("reverse_split")).toBeUndefined();
    expect(corporateActionKind(null)).toBeUndefined();
    expect(corporateActionKind("stock_split 1-for-10")).toBe("stock_split");
  });
});
