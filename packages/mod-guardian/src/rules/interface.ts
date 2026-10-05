import type { Alert, TokenState, UserHolding } from "../types";

export interface RulePorts {
  priceThresholds?: Record<string, { minPriceUsd?: number; maxPriceUsd?: number }>;
  onWarn?: (message: string) => void;
}

export interface Rule {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  evaluate(
    prev: TokenState | null,
    next: TokenState,
    holding: UserHolding,
    ports?: RulePorts,
  ): Alert[];
}

export function formatIssuer(issuer: string): string {
  switch (issuer.toLowerCase()) {
    case "ondo":
      return "Ondo";
    case "bstock":
      return "bStock";
    case "xstocks":
      return "xStocks";
    default:
      return issuer;
  }
}
