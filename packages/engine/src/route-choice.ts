import type { QuoteItem } from "@tally/binance";

export interface RouteChoice {
  route: QuoteItem;
  rfq: boolean;
}

/** Returns true if any hop in the route uses a market-maker (RFQ) protocol. */
export function isRfqRoute(item: QuoteItem): boolean {
  return item.dexRouterList.some((h) =>
    Boolean(h.dexProtocol?.dexName && /rfq/i.test(h.dexProtocol.dexName)),
  );
}

/**
 * Picks the best swap route for buys and sells.
 * Prefers an AMM pool route when its output is within 0.5% of the best RFQ output
 * to avoid short-lived market-maker order expiration (RFQ_OrderExpired).
 * Flags `rfq: true` only when an RFQ route is chosen.
 */
export function pickRoute(routes: QuoteItem[]): RouteChoice | undefined {
  if (routes.length === 0) return undefined;

  const rfqRoutes = routes.filter(isRfqRoute);
  const poolRoutes = routes.filter((r) => !isRfqRoute(r));

  const sortByOutput = (a: QuoteItem, b: QuoteItem) => {
    const diff = BigInt(b.toTokenAmount) - BigInt(a.toTokenAmount);
    return diff > 0n ? 1 : diff < 0n ? -1 : 0;
  };

  const bestRfq = [...rfqRoutes].sort(sortByOutput)[0];
  const bestPool = [...poolRoutes].sort(sortByOutput)[0];

  if (bestRfq && bestPool) {
    const rfqOut = BigInt(bestRfq.toTokenAmount);
    const poolOut = BigInt(bestPool.toTokenAmount);

    // Pool route is chosen when its output is within 0.5% of the best RFQ output:
    // (rfqOut - poolOut) / rfqOut <= 0.005  <=>  (rfqOut - poolOut) * 1000n <= rfqOut * 5n
    if (poolOut >= rfqOut || (rfqOut - poolOut) * 1000n <= rfqOut * 5n) {
      return { route: bestPool, rfq: false };
    }

    // RFQ is better by more than 0.5%
    return { route: bestRfq, rfq: true };
  }

  if (bestPool) {
    return { route: bestPool, rfq: false };
  }

  if (bestRfq) {
    return { route: bestRfq, rfq: true };
  }

  return undefined;
}

export const pickSellRoute = pickRoute;
export const pickBuyRoute = pickRoute;
