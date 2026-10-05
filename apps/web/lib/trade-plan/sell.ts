import type { Address } from "@tally/core";
import type { SellPlan } from "@tally/engine";
import {
  createIntentId,
  dispatchTradeStage,
  type TradeStageListener,
} from "../../components/trade/trade-stages";

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
export function emitSellStage(
  intent: SellIntent,
  stage: "intent" | "quote" | "simulation" | "signed" | "realized",
  data: {
    plan?: SellPlan;
    txHash?: string;
    status?: "success" | "reverted" | "pending";
    listener?: TradeStageListener;
  },
): void {
  const attempt = 1;
  const now = Date.now();

  if (stage === "intent") {
    dispatchTradeStage(
      "intent",
      {
        stage: "intent",
        intentId: intent.id,
        attempt,
        timestamp: now,
        ticker: intent.ticker,
        issuer: intent.issuer,
        symbol: intent.ticker,
        usd: Number(intent.minUsdtOut) / 1e18,
        tolerancePct: intent.tolerancePct,
        user: intent.user,
      },
      data.listener,
    );
  } else if (stage === "quote" && data.plan) {
    dispatchTradeStage(
      "quote",
      {
        stage: "quote",
        intentId: intent.id,
        attempt,
        timestamp: now,
        ticker: data.plan.ticker,
        issuer: data.plan.issuer,
        symbol: data.plan.symbol,
        stock: data.plan.stock,
        guard: data.plan.user, // Direct router EOA execution
        amountInUsdt: data.plan.quotedUsdtOut,
        tokensOut: data.plan.quotedUsdtOut,
        quotedShares: data.plan.sharesIn,
        minShares: data.plan.sharesIn,
        multiplier: data.plan.multiplier,
        usdPerShare: data.plan.usdPerShare,
        referencePrice: data.plan.referencePrice,
        premium: null,
        routeText: data.plan.routeText,
        hops: data.plan.hops,
        vendor: data.plan.vendor,
        feedUpdate: false,
        builtAt: data.plan.builtAt,
        expiresAt: data.plan.expiresAt,
        isRequote: false,
        warnings: data.plan.warnings,
      },
      data.listener,
    );
  } else if (stage === "simulation" && data.plan?.simulation) {
    dispatchTradeStage(
      "simulation",
      {
        stage: "simulation",
        intentId: intent.id,
        attempt,
        timestamp: now,
        available: true,
        ethCall: data.plan.simulation.ethCall,
        binance: data.plan.simulation.binance,
        binanceNote: data.plan.simulation.binanceNote,
        gasEstimate: data.plan.tx?.gasEstimate,
        gasLimit: data.plan.tx?.gasLimit,
        missingReason: null,
      },
      data.listener,
    );
  } else if (stage === "signed" && data.txHash) {
    dispatchTradeStage(
      "signed",
      {
        stage: "signed",
        intentId: intent.id,
        attempt,
        timestamp: now,
        txHash: data.txHash,
        isResumed: false,
        ticker: intent.ticker,
      },
      data.listener,
    );
  } else if (stage === "realized" && data.txHash) {
    dispatchTradeStage(
      "realized",
      {
        stage: "realized",
        intentId: intent.id,
        attempt,
        timestamp: now,
        txHash: data.txHash,
        status: data.status ?? "success",
        isResumed: false,
      },
      data.listener,
    );
  }
}
