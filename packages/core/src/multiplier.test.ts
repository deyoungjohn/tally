import { describe, expect, it } from "vitest";
import {
  checkOndoMultiplier,
  isUnitTrap,
  parseCorporateAction,
  resolveMultiplier,
  sharesFromTokens,
} from "./multiplier";
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
  it("NVDAx three-source mismatch (IDEAS F1): list 1.000000, dynamic 1.000918, on-chain 1.001701 → on-chain wins, flagged", () => {
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
  it("bStock on-chain matches the API (38/38 in F1): no disagreement", () => {
    const r = resolveMultiplier("bstock", {
      onchain: m("1.0007782237528078"),
      api: m("1.000778223752807865"),
      list: m("1.000778223752807865"),
    })!;
    expect(r.disagree).toBe(false);
    expect(r.source).toBe("onchain");
  });
  it("Ondo has no on-chain value: the API is the source", () => {
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
  const prev = { value: m("1.0017"), at: Date.UTC(2026, 8, 30) };
  const check = (current: string, reasonMsg?: string, previous: typeof prev | undefined = prev) =>
    checkOndoMultiplier({ current: m(current), previous, reasonMsg });

  it("an unchanged value passes", () => {
    expect(check("1.0017")).toMatchObject({ outcome: "pass" });
    expect(check("1.0017").detail).toMatch(/unchanged/);
  });

  describe("increases: one step up to 3% is accepted; above needs a corporate action", () => {
    it("accepts the steps measured between 2026-09-30 and 2026-10-02 (research/ondo-multiplier-steps.md): HYG +0.40%, USHY +0.58%, where a yield ÷ 365 cap (≈0.016%/day for HYG) would have rejected them", () => {
      for (const step of [1.004, 1.0058]) {
        const r = checkOndoMultiplier({
          current: m(String(step)),
          previous: { value: m("1"), at: 0 },
        });
        expect(r.outcome, String(step)).toBe("pass");
        expect(r.detail).toMatch(/within the 3% single-step limit/);
      }
    });
    it("exactly 3% passes; just above 3% fails without a corporate action and passes with one", () => {
      expect(
        checkOndoMultiplier({ current: m("1.0300"), previous: { value: m("1"), at: 0 } }).outcome,
      ).toBe("pass");
      const over = { current: m("1.0301"), previous: { value: m("1"), at: 0 } };
      expect(checkOndoMultiplier(over)).toMatchObject({ outcome: "fail" });
      expect(checkOndoMultiplier(over).detail).toMatch(/above 3% with no corporate action/);
      expect(checkOndoMultiplier({ ...over, reasonMsg: "stock_dividend announced" })).toMatchObject(
        { outcome: "pass" },
      );
    });
    it("a forward split is cross-checked when its ratio is readable: 10-for-1 must give new ≈ old × 10", () => {
      const one = { value: m("1"), at: 0 };
      expect(
        checkOndoMultiplier({ current: m("10"), previous: one, reasonMsg: "stock_split 10-for-1" })
          .outcome,
      ).toBe("pass");
      const bad = checkOndoMultiplier({
        current: m("5"),
        previous: one,
        reasonMsg: "stock_split 10-for-1",
      });
      expect(bad.outcome).toBe("fail");
      expect(bad.detail).toMatch(/expects 10, off by 50\.00%/);
    });
    it("time since the baseline does not matter: there is no per-day growth cap", () => {
      expect(
        checkOndoMultiplier({
          current: m("1.0250"),
          previous: { value: m("1"), at: Date.UTC(2020, 0, 1) },
        }).outcome,
      ).toBe("pass");
    });
  });

  describe("decreases: blocked unless a matching stock_split with new ≈ old × ratio (SOXS 0.1017 shows reverse splits happen)", () => {
    const before = { value: m("1.017"), at: Date.UTC(2026, 8, 30) }; // 10× SOXS's 0.1017
    it("a plain decrease fails", () => {
      const r = check("1.0010");
      expect(r.outcome).toBe("fail");
      expect(r.detail).toMatch(/decreased -0\.070%, no matching stock_split corporate action/);
    });
    it("a decrease with a stock_dividend (wrong kind) still fails", () => {
      expect(check("1.0010", "stock_dividend").outcome).toBe("fail");
    });
    it("a stock_split whose ratio can't be read is flagged and blocked: it can't be verified", () => {
      const r = checkOndoMultiplier({
        current: m("0.1017"),
        previous: before,
        reasonMsg: "stock_split",
      });
      expect(r.outcome).toBe("fail");
      expect(r.detail).toMatch(/ratio can't be read/);
    });
    it("a 1-for-10 reverse split with new = old × 0.1 passes", () => {
      const r = checkOndoMultiplier({
        current: m("0.1017"),
        previous: before,
        reasonMsg: "stock_split 1-for-10",
      });
      expect(r.outcome).toBe("pass");
      expect(r.detail).toMatch(
        /decreased -90\.000%, matching a stock_split ratio 0\.1 \(expected 0\.1017, off by 0\.00%\)/,
      );
    });
    it("accepts new within 1% of old × ratio (dividends accrued since the baseline) but not beyond", () => {
      expect(
        checkOndoMultiplier({
          current: m("0.1026"),
          previous: before,
          reasonMsg: "stock_split 1:10",
        }).outcome,
      ).toBe("pass"); // +0.88%
      expect(
        checkOndoMultiplier({
          current: m("0.1030"),
          previous: before,
          reasonMsg: "stock_split 1:10",
        }).outcome,
      ).toBe("fail"); // +1.28%
    });
    it("fails when the listed ratio disagrees with the multiplier: a 1-for-10 split cannot explain a drop to 0.5", () => {
      const r = checkOndoMultiplier({
        current: m("0.5"),
        previous: before,
        reasonMsg: "stock_split 1-for-10",
      });
      expect(r.outcome).toBe("fail");
      expect(r.detail).toMatch(/expects 0\.1017, off by/);
    });
  });

  it("no baseline: skipped (only sanity checked), and zero or negative always fails", () => {
    const none = checkOndoMultiplier({ current: m("1.0017") });
    expect(none).toMatchObject({ outcome: "skipped" });
    expect(none.detail).toMatch(/no baseline/);
    expect(checkOndoMultiplier({ current: 0n })).toMatchObject({ outcome: "fail" });
  });
  it("the detail line carries the numbers and the baseline date", () => {
    expect(check("1.0200").detail).toBe(
      "1.02 vs baseline 1.0017 (seen 2026-09-30): +1.827%, within the 3% single-step limit",
    );
  });
});

describe("parseCorporateAction", () => {
  it("reads the kind, and a ratio as new:old", () => {
    expect(parseCorporateAction("stock_split 10-for-1")).toEqual({
      kind: "stock_split",
      ratio: 10,
    });
    expect(parseCorporateAction("Stock_Split 1-for-10")).toEqual({
      kind: "stock_split",
      ratio: 0.1,
    });
    expect(parseCorporateAction("stock_split (1:10)")).toEqual({ kind: "stock_split", ratio: 0.1 });
    expect(parseCorporateAction("stock_dividend 3 for 2")).toEqual({
      kind: "stock_dividend",
      ratio: 1.5,
    });
  });
  it("a kind with no readable ratio has no ratio; anything else is not an action", () => {
    expect(parseCorporateAction("stock_split")).toEqual({ kind: "stock_split" });
    expect(parseCorporateAction("Paused for session transition")).toBeUndefined();
    expect(parseCorporateAction(null)).toBeUndefined();
    expect(parseCorporateAction("stock_split 1-for-0")).toEqual({ kind: "stock_split" });
  });
});
