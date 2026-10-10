import { describe, expect, it } from "vitest";
import { dec3, dec3Down, roundDecimal, usdt2, usdt2Down } from "./receipt-format";

describe("receipt number formats", () => {
  it("rounds amounts to 3 places and drops trailing zeros", () => {
    expect(dec3("0.084662791783010898")).toBe("0.085");
    expect(dec3("10.000000")).toBe("10");
    expect(dec3("0.0004")).toBe("0");
    expect(dec3("1.2345")).toBe("1.235");
  });
  it("rounds USDT up to 2 places and keeps the cents", () => {
    expect(usdt2("19.514874711010090824")).toBe("19.52");
    expect(usdt2("19.50")).toBe("19.50");
    expect(usdt2("19.5")).toBe("19.50");
    expect(usdt2("0.001")).toBe("0.01");
  });
  it("rounds a guarantee down, never up", () => {
    expect(usdt2Down("19.519")).toBe("19.51");
    expect(dec3Down("0.08386951")).toBe("0.083");
  });
  it("carries across the decimal point and keeps the sign", () => {
    expect(roundDecimal("9.9996", 3)).toBe("10.000");
    expect(roundDecimal("-0.0004", 3)).toBe("0.000");
    expect(roundDecimal("-1.2346", 3)).toBe("-1.235");
  });
});
