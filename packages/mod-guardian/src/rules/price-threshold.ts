import type { Alert, TokenState, UserHolding } from "../types";
import { type Rule, type RulePorts } from "./interface";

export class PriceThresholdRule implements Rule {
  readonly id = "price-threshold";
  readonly name = "Per-Share Price Threshold";
  readonly description =
    "Alerts when a token's per-share price crosses a user threshold during regular market sessions.";

  evaluate(
    prev: TokenState | null,
    next: TokenState,
    holding: UserHolding,
    ports?: RulePorts,
  ): Alert[] {
    // Regular session only per work order requirement
    if (next.session !== "regular") {
      return [];
    }

    if (next.sharePriceUsd === null || next.sharePriceUsd === undefined) {
      return [];
    }

    const thresholds = ports?.priceThresholds?.[next.tokenAddress.toLowerCase()];
    if (!thresholds) {
      return [];
    }

    const currentPrice = next.sharePriceUsd;
    const prevPrice = prev?.sharePriceUsd;
    const alerts: Alert[] = [];

    // Min price alert (downward break)
    if (thresholds.minPriceUsd !== undefined) {
      const min = thresholds.minPriceUsd;
      const breached = currentPrice < min;
      const wasBreached = prevPrice !== undefined && prevPrice !== null && prevPrice < min;

      if (breached && !wasBreached) {
        alerts.push({
          id: `price-threshold:min:${next.tokenAddress.toLowerCase()}:${next.observedAt}`,
          rule: this.id,
          ticker: holding.ticker,
          issuer: holding.issuer,
          severity: "warning",
          title: `${holding.ticker} fell below $${min.toFixed(2)}`,
          body: `${holding.ticker} per-share price is $${currentPrice.toFixed(2)}, below your alert threshold of $${min.toFixed(2)}.`,
          evidence: {
            snapshotKind: "price",
            snapshotKey: next.tokenAddress.toLowerCase(),
            observedAt: next.observedAt,
          },
          createdAt: next.observedAt,
        });
      }
    }

    // Max price alert (upward break)
    if (thresholds.maxPriceUsd !== undefined) {
      const max = thresholds.maxPriceUsd;
      const breached = currentPrice > max;
      const wasBreached = prevPrice !== undefined && prevPrice !== null && prevPrice > max;

      if (breached && !wasBreached) {
        alerts.push({
          id: `price-threshold:max:${next.tokenAddress.toLowerCase()}:${next.observedAt}`,
          rule: this.id,
          ticker: holding.ticker,
          issuer: holding.issuer,
          severity: "info",
          title: `${holding.ticker} rose above $${max.toFixed(2)}`,
          body: `${holding.ticker} per-share price is $${currentPrice.toFixed(2)}, above your alert threshold of $${max.toFixed(2)}.`,
          evidence: {
            snapshotKind: "price",
            snapshotKey: next.tokenAddress.toLowerCase(),
            observedAt: next.observedAt,
          },
          createdAt: next.observedAt,
        });
      }
    }

    return alerts;
  }
}
