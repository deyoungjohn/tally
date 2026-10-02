import { describe, expect, it } from "vitest";
import { formatUnits, mulDiv, mulDivUp, parseDecimal, toNumber } from "./units";

describe("units", () => {
  it("parses plain decimals to fixed point and truncates extra digits", () => {
    expect(parseDecimal("10", 18)).toBe(10n * 10n ** 18n);
    expect(parseDecimal("1.0017152487959898", 18)).toBe(1001715248795989800n);
    expect(parseDecimal("0.5", 6)).toBe(500000n);
    expect(parseDecimal("1.23456789", 4)).toBe(12345n);
  });
  it("rejects scientific notation and junk instead of guessing", () => {
    expect(() => parseDecimal("1e18", 18)).toThrow();
    expect(() => parseDecimal("", 18)).toThrow();
    expect(() => parseDecimal("1,5", 18)).toThrow();
  });
  it("formats and round-trips", () => {
    expect(formatUnits(25977437932023150n, 18)).toBe("0.02597743793202315");
    expect(formatUnits(25977437932023150n, 18, 6)).toBe("0.025977");
    expect(formatUnits(5n * 10n ** 18n, 18)).toBe("5");
    expect(formatUnits(-1500000n, 6)).toBe("-1.5");
    expect(toNumber(parseDecimal("229.84", 18), 18)).toBe(229.84);
  });
  it("mulDiv floors and mulDivUp ceils", () => {
    expect(mulDiv(7n, 1n, 2n)).toBe(3n);
    expect(mulDivUp(7n, 1n, 2n)).toBe(4n);
    expect(() => mulDiv(1n, 1n, 0n)).toThrow();
  });
});
