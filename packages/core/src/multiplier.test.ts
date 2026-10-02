import { describe, expect, it } from "vitest";
import { checkOndoMultiplier, isUnitTrap, resolveMultiplier, sharesFromTokens } from "./multiplier";
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

describe("Ondo bounds (blueprint §7.3): never decreases, one increase ≤ 3%, above 3% needs a corporate action", () => {
  const base = m("1.0017");
  const prev = { value: base, at: Date.UTC(2026, 8, 30) };
  const b = (
    current: string,
    extra: { reasonMsg?: string } = {},
    previous: typeof prev | undefined = prev,
  ) => checkOndoMultiplier({ current: m(current), previous, ...extra });

  it("an unchanged value passes", () => {
    expect(b("1.0017")).toMatchObject({ outcome: "pass" });
    expect(b("1.0017").detail).toMatch(/unchanged/);
  });
  it("a decrease fails, even with a corporate action listed", () => {
    expect(b("1.0010")).toMatchObject({ outcome: "fail" });
    expect(b("1.0010").detail).toMatch(/decreased/);
    expect(b("1.0010", { reasonMsg: "stock_split" }).outcome).toBe("fail");
  });
  it("an ex-dividend jump is accepted: PFE moved about +1.5% in one day, and a per-day yield cap would have blocked it", () => {
    const r = checkOndoMultiplier({
      current: m("1.0609"),
      previous: { value: m("1.0452"), at: 0 },
    }); // +1.50%
    expect(r.outcome).toBe("pass");
    expect(r.detail).toMatch(/\+1\.502%.*within the 3% single-step limit/);
  });
  it("exactly 3% passes; just above 3% fails without a corporate action and passes with one", () => {
    expect(
      checkOndoMultiplier({ current: m("1.0300"), previous: { value: m("1"), at: 0 } }).outcome,
    ).toBe("pass");
    const over = { current: m("1.0301"), previous: { value: m("1"), at: 0 } };
    expect(checkOndoMultiplier(over)).toMatchObject({ outcome: "fail" });
    expect(checkOndoMultiplier(over).detail).toMatch(/above 3% with no corporate action/);
    expect(checkOndoMultiplier({ ...over, reasonMsg: "stock_dividend announced" })).toMatchObject({
      outcome: "pass",
    });
    expect(
      checkOndoMultiplier({
        current: m("10"),
        previous: { value: m("1"), at: 0 },
        reasonMsg: "stock_split",
      }).outcome,
    ).toBe("pass"); // 10-for-1 style split
  });
  it("time since the baseline does not matter: there is no per-day growth cap", () => {
    const old = { value: m("1.0000"), at: Date.UTC(2020, 0, 1) };
    expect(checkOndoMultiplier({ current: m("1.0250"), previous: old }).outcome).toBe("pass");
  });
  it("no baseline: skipped (only sanity checked), and zero or negative always fails", () => {
    const none = checkOndoMultiplier({ current: m("1.0017") });
    expect(none).toMatchObject({ outcome: "skipped" });
    expect(none.detail).toMatch(/no baseline/);
    expect(checkOndoMultiplier({ current: 0n })).toMatchObject({ outcome: "fail" });
  });
  it("the detail line carries the numbers and the baseline date", () => {
    expect(b("1.0200").detail).toBe(
      "1.02 vs baseline 1.0017 (seen 2026-09-30): +1.827%, within the 3% single-step limit",
    );
  });
});
