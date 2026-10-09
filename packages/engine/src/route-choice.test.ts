import { describe, expect, it } from "vitest";
import type { QuoteItem } from "@tally/binance";
import { pickMatchingRoute } from "@tally/binance";
import { isRfqRoute, pickBuyRoute, pickRoute, pickSellRoute } from "./route-choice";

function makeRoute(dexName: string, toTokenAmount: string, quoteId = "q-1"): QuoteItem {
  return {
    quoteId,
    toTokenAmount,
    fromTokenAmount: "6000000000000000000",
    executionMode: "SWAP",
    vendorName: "LiquidMesh",
    approveTarget: "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5",
    dexRouterList: [
      {
        toTokenIndex: "0",
        toToken: { tokenSymbol: "TOKEN" },
        dexProtocol: { dexName },
      },
    ],
    fromToken: { tokenUnitPrice: "1" },
    toToken: { tokenContractAddress: "0x123", tokenSymbol: "TOKEN", tokenUnitPrice: "100" },
  } as unknown as QuoteItem;
}

describe("route-choice: RFQ vs pool route selection", () => {
  describe("isRfqRoute", () => {
    it("identifies RFQ routes by dexName case-insensitively", () => {
      expect(isRfqRoute(makeRoute("Rfq Neptunex", "1000"))).toBe(true);
      expect(isRfqRoute(makeRoute("RFQ Halfmoon", "1000"))).toBe(true);
      expect(isRfqRoute(makeRoute("rfq newworld", "1000"))).toBe(true);
    });

    it("returns false for AMM pool routes", () => {
      expect(isRfqRoute(makeRoute("Pancakeswap V3", "1000"))).toBe(false);
      expect(isRfqRoute(makeRoute("Pancakeswap V4", "1000"))).toBe(false);
      expect(isRfqRoute(makeRoute("Elfomofi", "1000"))).toBe(false);
      expect(isRfqRoute(makeRoute("Thena", "1000"))).toBe(false);
    });
  });

  describe("pickRoute", () => {
    it("prefers pool route when its output is within 0.5% of best RFQ output", () => {
      // RFQ: 10.0, Pool: 9.96 (difference 0.4% <= 0.5%)
      const pool = makeRoute("Pancakeswap V4", "9960000000000000000", "pool-1");
      const rfq = makeRoute("Rfq Neptunex", "10000000000000000000", "rfq-1");

      const res = pickRoute([pool, rfq]);
      expect(res).toEqual({ route: pool, rfq: false });
    });

    it("prefers pool route when its output is exactly 0.5% below best RFQ output", () => {
      // RFQ: 10.0, Pool: 9.95 (difference 0.5% <= 0.5%)
      const pool = makeRoute("Pancakeswap V4", "9950000000000000000", "pool-1");
      const rfq = makeRoute("Rfq Neptunex", "10000000000000000000", "rfq-1");

      const res = pickRoute([pool, rfq]);
      expect(res).toEqual({ route: pool, rfq: false });
    });

    it("prefers pool route when pool output is greater than or equal to RFQ output", () => {
      const pool = makeRoute("Pancakeswap V3", "10000000000000000000", "pool-1");
      const rfq = makeRoute("Rfq Neptunex", "10000000000000000000", "rfq-1");

      const res = pickRoute([pool, rfq]);
      expect(res).toEqual({ route: pool, rfq: false });
    });

    it("uses RFQ route and flags rfq: true when RFQ is better by more than 0.5%", () => {
      // RFQ: 10.0, Pool: 9.94 (difference 0.6% > 0.5%)
      const pool = makeRoute("Pancakeswap V4", "9940000000000000000", "pool-1");
      const rfq = makeRoute("Rfq Neptunex", "10000000000000000000", "rfq-1");

      const res = pickRoute([pool, rfq]);
      expect(res).toEqual({ route: rfq, rfq: true });
    });

    it("uses RFQ route and flags rfq: true when only RFQ route exists", () => {
      const rfq = makeRoute("Rfq Halfmoon", "10000000000000000000", "rfq-1");

      const res = pickRoute([rfq]);
      expect(res).toEqual({ route: rfq, rfq: true });
    });

    it("uses pool route and flags rfq: false when only pool route exists", () => {
      const pool = makeRoute("Pancakeswap V3", "10000000000000000000", "pool-1");

      const res = pickRoute([pool]);
      expect(res).toEqual({ route: pool, rfq: false });
    });

    it("returns undefined when routes array is empty", () => {
      expect(pickRoute([])).toBeUndefined();
    });

    it("correctly identifies the best among multiple RFQ routes and multiple pool routes", () => {
      const poolWorst = makeRoute("Pancakeswap V2", "9000000000000000000", "pool-worst");
      const poolBest = makeRoute("Pancakeswap V3", "9960000000000000000", "pool-best");
      const rfqWorst = makeRoute("Rfq Halfmoon", "9980000000000000000", "rfq-worst");
      const rfqBest = makeRoute("Rfq Neptunex", "10000000000000000000", "rfq-best");

      // poolBest (9.96) is within 0.5% of rfqBest (10.0) -> poolBest chosen
      const res = pickRoute([poolWorst, rfqWorst, poolBest, rfqBest]);
      expect(res).toEqual({ route: poolBest, rfq: false });
    });

    it("aliases pickSellRoute and pickBuyRoute to pickRoute", () => {
      expect(pickSellRoute).toBe(pickRoute);
      expect(pickBuyRoute).toBe(pickRoute);
    });
  });

  describe("adapters: pickMatchingRoute consistency", () => {
    it("matches pickRoute behavior across all comparison cases", () => {
      const poolWithin = makeRoute("Pancakeswap V4", "9960000000000000000", "pool-1");
      const poolBeyond = makeRoute("Pancakeswap V4", "9940000000000000000", "pool-2");
      const rfq = makeRoute("Rfq Neptunex", "10000000000000000000", "rfq-1");

      // Pool within 0.5%
      expect(pickMatchingRoute([poolWithin, rfq])).toBe(poolWithin);
      // RFQ better by >0.5%
      expect(pickMatchingRoute([poolBeyond, rfq])).toBe(rfq);
      // RFQ only
      expect(pickMatchingRoute([rfq])).toBe(rfq);
      // Pool only
      expect(pickMatchingRoute([poolWithin])).toBe(poolWithin);
      // Empty
      expect(pickMatchingRoute([])).toBeUndefined();
    });
  });
});
