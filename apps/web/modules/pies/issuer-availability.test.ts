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
  expect(isBuyable("BABA")).toBe(true);
  expect(issuersOf("BABA")).toEqual(["bstock"]);
  expect(isTokenBuyable("baba", "bstock")).toBe(true);
  expect(isTokenBuyable("BABA", "ondo")).toBe(false);
  expect(issuersOf("HOOD")).toEqual(["bstock"]);
  expect(isTokenBuyable("HOOD", "bstock")).toBe(true);
  expect(isTokenBuyable("HOOD", "ondo")).toBe(false);
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

it("the nine newly enabled tokens are buyable from their issuer", () => {
  for (const [ticker, issuer] of [
    ["BMNR", "bstock"],
    ["AMZN", "bstock"],
    ["GME", "bstock"],
    ["INTC", "ondo"],
    ["META", "ondo"],
    ["MSFT", "ondo"],
    ["MSTR", "ondo"],
    ["NFLX", "bstock"],
    ["NFLX", "ondo"],
  ] as const)
    expect(isTokenBuyable(ticker, issuer)).toBe(true);
});
