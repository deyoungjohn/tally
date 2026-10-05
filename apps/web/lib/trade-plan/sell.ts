import type { Address } from "@tally/core";
import type { SellPlan } from "@tally/engine";
import { createIntentId, type TradeStageListener } from "../../components/trade/trade-stages";

export interface SellIntent {
  id: string;
  kind: "sell";
  ticker: string;
  issuer: "ondo" | "bstock";
  stock: Address;
  user: Address;
  tokensIn: bigint;
  minUsdtOut: bigint;
  tolerancePct: number;
  approvedAt: number | null;
}

export type TradeIntent =
  | {
      id: string;
      kind: "buy";
      ticker: string;
      issuer: "ondo" | "bstock";
      stock: Address;
      user: Address;
      recipient: Address;
      amountInUsdt: bigint;
      minShares: bigint;
      tolerancePct: number;
      approvedAt: number | null;
    }
  | SellIntent
  | {
      id: string;
      kind: "switch";
      ticker: string;
      fromStock: Address;
      toStock: Address;
      fromIssuer: "ondo" | "bstock";
      toIssuer: "ondo" | "bstock";
      user: Address;
      recipient: Address;
      tokensIn: bigint;
      minSharesOut: bigint;
      tolerancePct: number;
      approvedAt: number | null;
    };

export interface FetchSellPlanParams {
  ticker: string;
  issuer: "ondo" | "bstock";
  usd?: number;
  shares?: number;
  tokens?: string;
  tolerancePct?: number;
  user: Address;
  fetchFn?: typeof fetch;
}

/**
 * Fetch a fresh sell trade plan from /api/trade/sell.
 */
export async function fetchSellPlan(params: FetchSellPlanParams): Promise<SellPlan> {
  const fetchImpl = params.fetchFn ?? fetch;
  const res = await fetchImpl("/api/trade/sell", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticker: params.ticker,
      issuer: params.issuer,
      usd: params.usd,
      shares: params.shares,
      tokens: params.tokens,
      tolerancePct: params.tolerancePct,
      user: params.user,
    }),
  });

  if (!res.ok) {
    const errorJson = (await res.json().catch(() => null)) as {
      error?: { kind?: string; message?: string };
    } | null;
    const message = errorJson?.error?.message ?? `Sell plan failed with HTTP ${res.status}`;
    const err = new Error(message) as Error & { kind?: string };
    err.kind = errorJson?.error?.kind ?? "sell_failed";
    throw err;
  }

  return (await res.json()) as SellPlan;
}

/**
 * Creates and initializes a SellIntent.
 */
export function createSellIntent(
  ticker: string,
  issuer: "ondo" | "bstock",
  stock: Address,
  user: Address,
  tokensIn: bigint,
  minUsdtOut: bigint,
  tolerancePct = 1,
): SellIntent {
  return {
    id: createIntentId(),
    kind: "sell",
    ticker: ticker.toUpperCase(),
    issuer,
    stock,
    user,
    tokensIn,
    minUsdtOut,
    tolerancePct,
    approvedAt: null,
  };
}

/**
 * Emits stage events for the Sell pipeline to notify subscribers (Receipts recorder, hooks).
 */
/**
 * Sell stage events: currently a no-op because receipts only accept ShareGuard buy hints.
 * Emitting buy-shaped events would cause /api/receipts to refuse them (422) since field definitions differ.
 * Sells will emit stages once receipts support direct router sell verification.
 */
export function emitSellStage(
  _intent: SellIntent,
  _stage: "intent" | "quote" | "simulation" | "signed" | "realized",
  _data: {
    plan?: SellPlan;
    txHash?: string;
    status?: "success" | "reverted" | "pending";
    listener?: TradeStageListener;
  },
): void {
  // Deliberately no-op to prevent premature 422 receipt rejection
}
