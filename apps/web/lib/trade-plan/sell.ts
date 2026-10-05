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

export interface PostSellReceiptHintParams {
  intent: SellIntent;
  txHash: `0x${string}`;
  plan?: SellPlan | null;
  attempt?: number;
  isResumed?: boolean;
  fetchFn?: typeof fetch;
}

/**
 * Fire-and-forget: posts a sell receipt hint to /api/receipts.
 * Condition 7: Never blocks or fails the sell, runs only after the transaction hash exists,
 * and is a no-op when FEATURE_RECEIPTS is off (route answers 404).
 */
export function postSellReceiptHint(params: PostSellReceiptHintParams): void {
  try {
    const fetchImpl = params.fetchFn ?? fetch;
    const quote = params.plan
      ? {
          stock: params.plan.stock,
          issuer: params.plan.issuer,
          tokensIn: params.plan.tokensIn,
          minUsdtOut: params.plan.minUsdtOut,
          quotedUsdtOut: params.plan.quotedUsdtOut,
          hops: params.plan.hops,
          routeText: params.plan.routeText,
          builtAt: params.plan.builtAt,
          expiresAt: params.plan.expiresAt,
        }
      : null;

    const body = {
      version: 1,
      kind: "sell",
      txHash: params.txHash,
      intentId: params.intent.id,
      attempt: params.attempt ?? 1,
      user: params.intent.user,
      ticker: params.intent.ticker,
      isResumed: params.isResumed ?? false,
      quote,
      simulation: null,
    };

    fetchImpl("/api/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {
      // Fire-and-forget: never block or fail the sell
    });
  } catch {
    // Fire-and-forget
  }
}

/**
 * Emits stage events for the Sell pipeline to notify subscribers (Receipts recorder, hooks).
 * Dispatches fire-and-forget receipt hint when transaction hash is present.
 */
export function emitSellStage(
  intent: SellIntent,
  _stage: "intent" | "quote" | "simulation" | "signed" | "realized",
  data: {
    plan?: SellPlan;
    txHash?: string;
    status?: "success" | "reverted" | "pending";
    listener?: TradeStageListener;
  },
): void {
  if (data.txHash && /^0x[\da-f]{64}$/i.test(data.txHash)) {
    postSellReceiptHint({
      intent,
      txHash: data.txHash as `0x${string}`,
      plan: data.plan,
    });
  }
}
