/**
 * Typed trade stage events contract and subscription registry for Tally trade flow (WO-01 / WO-02).
 *
 * Exposes the 5 trade lifecycle stages:
 *  1. intent     - user requests a trade with specified parameters and signed-in address
 *  2. quote      - quote and trade plan received from engine
 *  3. simulation - on-chain simulation evidence when available (or explicit missing reason)
 *  4. signed     - transaction submitted to wallet and broadcast (txHash only, never signature material)
 *  5. realized   - confirmed receipt from network with fill execution details or revert reason
 *
 * All amounts are lossless integer strings (1e18 fixed point or raw token units), safe for JSON transmission.
 * Correlates operations with intentId and attempt count across re-quotes and resumed receipts.
 */

export type TradeStage = "intent" | "quote" | "simulation" | "signed" | "realized";

export interface IntentStagePayload {
  stage: "intent";
  intentId: string;
  attempt: number;
  timestamp: number;
  ticker: string;
  issuer: "ondo" | "bstock";
  symbol: string;
  usd: number;
  tolerancePct: number;
  user: string;
}

export interface QuoteStagePayload {
  stage: "quote";
  intentId: string;
  attempt: number;
  timestamp: number;
  ticker: string;
  issuer: "ondo" | "bstock";
  symbol: string;
  stock: string;
  guard: string;
  amountInUsdt: string;
  tokensOut: string;
  quotedShares: string;
  minShares: string;
  multiplier: string;
  usdPerShare: number;
  referencePrice: number | null;
  premium: number | null;
  routeText: string;
  hops: number;
  vendor: string;
  feedUpdate: boolean;
  builtAt: number;
  expiresAt: number;
  isRequote: boolean;
  warnings: readonly string[];
}

export type SimulationStagePayload =
  | {
      stage: "simulation";
      intentId: string;
      attempt: number;
      timestamp: number;
      available: true;
      ethCall: "ok";
      binance: "ok" | "skipped";
      binanceNote?: string;
      gasEstimate?: string;
      gasLimit?: string;
      missingReason: null;
    }
  | {
      stage: "simulation";
      intentId: string;
      attempt: number;
      timestamp: number;
      available: false;
      ethCall?: undefined;
      binance?: undefined;
      binanceNote?: undefined;
      gasEstimate?: undefined;
      gasLimit?: undefined;
      missingReason: string;
    };

export interface SignedStagePayload {
  stage: "signed";
  intentId: string;
  attempt: number;
  timestamp: number;
  txHash: string;
  isResumed: boolean;
  ticker?: string;
  symbol?: string;
}

export interface RealizedStagePayload {
  stage: "realized";
  intentId: string;
  attempt: number;
  timestamp: number;
  txHash: string;
  status: "success" | "reverted" | "pending";
  isResumed: boolean;
  blockNumber?: number;
  gasUsed?: number;
  gasUsd?: number | null;
  bscscan?: string;
  warning?: string;
  fill?: {
    tokensOut: string;
    shares: string;
    multiplier: string;
    amountInUsdt: string;
    usdPerShare: number;
    referencePrice: number | null;
    premium: number | null;
    stock: string;
    user: string;
  };
}

export interface TradeStagePayloadMap {
  intent: IntentStagePayload;
  quote: QuoteStagePayload;
  simulation: SimulationStagePayload;
  signed: SignedStagePayload;
  realized: RealizedStagePayload;
}

export type TradeStageListener = <S extends TradeStage>(
  stage: S,
  payload: TradeStagePayloadMap[S],
) => void | Promise<void>;

const globalSubscribers = new Set<TradeStageListener>();

/**
 * Generate a unique intent ID for correlating an entire trade lifecycle attempt.
 */
export function createIntentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `intent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Subscribe a global listener to all trade stage events.
 * Browser only: returns an unsubscribe cleanup function.
 * On server (Node.js/SSR), this is a no-op that returns an empty cleanup function.
 */
export function subscribeTradeStage(listener: TradeStageListener): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  globalSubscribers.add(listener);
  return () => {
    globalSubscribers.delete(listener);
  };
}

/**
 * Test helper to inspect registered subscriber count.
 */
export function getTradeStageSubscriberCount(): number {
  return globalSubscribers.size;
}

/**
 * Test helper to clear global subscribers between test cases.
 */
export function clearTradeStageSubscribersForTests(): void {
  globalSubscribers.clear();
}

/**
 * Safely dispatches a stage event to local (hook) and global subscribers.
 *
 * Invariants:
 * - Every event is delivered exactly once to each subscriber.
 * - Hook onStage and global listeners are separate targets; if both exist, neither is called twice.
 * - Any listener that throws or returns a rejected promise is caught and logged via console.warn,
 *   never disrupting trade approval, confirmation, or execution.
 * - Browser only: returns immediately if window is undefined.
 */
export function dispatchTradeStage<S extends TradeStage>(
  stage: S,
  payload: TradeStagePayloadMap[S],
  localListener?: TradeStageListener,
): void {
  if (typeof window === "undefined") return;

  const targets: TradeStageListener[] = [];
  if (localListener) {
    targets.push(localListener);
  }
  for (const sub of globalSubscribers) {
    if (sub !== localListener) {
      targets.push(sub);
    }
  }

  for (const listener of targets) {
    try {
      const result = listener(stage, payload);
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch((err) => {
          console.warn(`[TradeStages] subscriber rejected on stage '${stage}':`, err);
        });
      }
    } catch (err) {
      console.warn(`[TradeStages] subscriber threw on stage '${stage}':`, err);
    }
  }
}

// Expose on window in browser environments for e2e test hooks without modifying trade UI
if (typeof window !== "undefined") {
  (
    window as unknown as { __tallySubscribeTradeStage?: typeof subscribeTradeStage }
  ).__tallySubscribeTradeStage = subscribeTradeStage;
}
