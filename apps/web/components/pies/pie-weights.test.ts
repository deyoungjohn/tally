import { describe, expect, it } from "vitest";
import { bpsToPercent, equalWeights, normaliseWeights, percentToBps } from "./pie-weights";

describe("percentToBps", () => {
  it("reads percent text with at most two decimals", () => {
    expect(percentToBps("20")).toBe(2000);
    expect(percentToBps("33.33")).toBe(3333);
    expect(percentToBps(".5")).toBe(50);
    expect(percentToBps("100")).toBe(10000);
    expect(percentToBps("0")).toBe(0);
  });
  it("rejects anything else", () => {
    for (const bad of ["", "abc", "-1", "101", "1.234", "1e2", "20%"])
      expect(percentToBps(bad)).toBeNull();
  });
  it("round trips", () => {
    expect(bpsToPercent(3333)).toBe("33.33");
    expect(bpsToPercent(2000)).toBe("20");
  });
});

describe("equalWeights", () => {
  it("splits evenly and always totals 100%", () => {
    expect(Object.values(equalWeights(["A", "B", "C", "D", "E"]))).toEqual([
      2000, 2000, 2000, 2000, 2000,
    ]);
    const three = equalWeights(["A", "B", "C"]);
    expect(Object.values(three)).toEqual([3334, 3333, 3333]);
    expect(Object.values(three).reduce((a, b) => a + b, 0)).toBe(10000);
    expect(equalWeights([])).toEqual({});
  });
});

describe("normaliseWeights", () => {
  it("scales to exactly 100% and keeps the proportions", () => {
    const out = normaliseWeights({ A: 1000, B: 1000, C: 2000 })!;
    expect(out).toEqual({ A: 2500, B: 2500, C: 5000 });
  });
  it("puts the rounding remainder on the largest weight", () => {
    const out = normaliseWeights({ A: 1, B: 1, C: 1 })!;
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(10000);
  });
  it("is null when every weight is zero", () => {
    expect(normaliseWeights({ A: 0, B: 0 })).toBeNull();
  });
});
