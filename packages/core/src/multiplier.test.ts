import { describe, expect, it } from "vitest";
import { checkOndoMultiplier, isUnitTrap, resolveMultiplier, sharesFromTokens } from "./multiplier";
import { parseDecimal } from "./units";

const m = (s: string) => parseDecimal(s, 18);
const DAY = 86_400_000;

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
  const base = m("1.0017");
  const prev = { value: base, at: 0 };
  it("accepts an unchanged value and a first reading", () => {
    expect(checkOndoMultiplier({ current: base, previous: prev, now: DAY }).ok).toBe(true);
    expect(checkOndoMultiplier({ current: base, now: DAY }).ok).toBe(true);
  });
  it("rejects a decrease unless a corporate action explains it", () => {
    expect(checkOndoMultiplier({ current: m("1.0010"), previous: prev, now: DAY })).toMatchObject({
      ok: false,
    });
    expect(
      checkOndoMultiplier({
        current: m("1.0010"),
        previous: prev,
        now: DAY,
        reasonMsg: "stock_split pending",
      }).ok,
    ).toBe(true);
  });
  it("accepts dividend-sized daily growth, rejects faster growth", () => {
    // 0.32% yield/year → 0.00088%/day allowed, plus 0.2% epsilon
    expect(
      checkOndoMultiplier({ current: m("1.0018"), previous: prev, now: DAY, dividendYield: 0.0032 })
        .ok,
    ).toBe(true);
    expect(
      checkOndoMultiplier({
        current: m("1.0100"),
        previous: prev,
        now: DAY,
        dividendYield: 0.0032,
      }),
    ).toMatchObject({ ok: false });
  });
  it("jumps above 3% need a matching corporate action, even over many days", () => {
    expect(checkOndoMultiplier({ current: m("1.2"), previous: prev, now: 30 * DAY })).toMatchObject(
      { ok: false },
    );
    expect(
      checkOndoMultiplier({
        current: m("10"),
        previous: prev,
        now: DAY,
        reasonMsg: "stock_dividend",
      }).ok,
    ).toBe(true);
  });
  it("rejects zero", () => {
    expect(checkOndoMultiplier({ current: 0n, now: 0 }).ok).toBe(false);
  });
});
