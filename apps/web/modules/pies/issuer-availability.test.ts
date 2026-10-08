import { expect, it } from "vitest";
import { GENERATED_BUYABLE_ASSETS } from "../../lib/buyable.generated";
import { BUYABLE_TICKERS, isBuyable, isTokenBuyable, issuersOf } from "../../lib/tickers";

it("lists exactly the manifest issuers for every buyable ticker", () => {
  for (const { ticker } of BUYABLE_TICKERS) {
    const expected = [
      ...new Set(
        GENERATED_BUYABLE_ASSETS.filter((asset) => asset.ticker === ticker).map(
          (asset) => asset.kind,
        ),
      ),
    ].sort();
    expect(issuersOf(ticker)).toEqual(expected);
    expect(issuersOf(ticker.toLowerCase())).toEqual(expected);
  }
});

it("a one-issuer ticker cannot be bought through its disabled twin", () => {
  expect(isBuyable("NFLX")).toBe(true);
  expect(issuersOf("NFLX")).toEqual(["ondo"]);
  expect(isTokenBuyable("nflx", "ondo")).toBe(true);
  expect(isTokenBuyable("NFLX", "bstock")).toBe(false);
  expect(issuersOf("MSFT")).toEqual(["bstock"]);
  expect(isTokenBuyable("MSFT", "bstock")).toBe(true);
  expect(isTokenBuyable("MSFT", "ondo")).toBe(false);
});

it("a two-issuer ticker enables either destination, never xstocks", () => {
  expect(issuersOf("NVDA")).toEqual(["bstock", "ondo"]);
  expect(isTokenBuyable("NVDA", "bstock")).toBe(true);
  expect(isTokenBuyable("NVDA", "ondo")).toBe(true);
  expect(isTokenBuyable("NVDA", "xstocks")).toBe(false);
});

it.each(["DJT", "UNKNOWN", "constructor", "__proto__"])(
  "returns no issuers or buy eligibility for unenabled ticker %s",
  (ticker) => {
    expect(issuersOf(ticker)).toEqual([]);
    expect(isTokenBuyable(ticker, "ondo")).toBe(false);
    expect(isTokenBuyable(ticker, "bstock")).toBe(false);
  },
);
