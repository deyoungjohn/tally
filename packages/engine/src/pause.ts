import { LIQUIDMESH_ROUTER } from "@tally/config";
import type { Address } from "@tally/core";
import type { TradeChain } from "./trade";

export interface PauseStateResult {
  paused: boolean | null;
  reason: string | null;
  observedAt: number;
}

/**
 * Accessor for token pause state on BSC via ShareGuard.
 * Calls TradeChain.readGuard(stock, LIQUIDMESH_ROUTER).
 *
 * Returns:
 * - { paused: true, reason: null, observedAt } when token is paused
 * - { paused: false, reason: null, observedAt } when token is active
 * - { paused: null, reason: "token not configured in ShareGuard", observedAt } when asset is not enabled in ShareGuard
 * - { paused: null, reason: "pause check reverted", observedAt } when isTokenPaused check reverted on-chain
 * - { paused: null, reason: "guard read failed; details withheld", observedAt } when readGuard itself fails/reverts
 */
export async function pauseState(
  chain: Pick<TradeChain, "readGuard">,
  tokenAddress: Address,
  now: () => number = Date.now,
): Promise<PauseStateResult> {
  const observedAt = now();
  try {
    const g = await chain.readGuard(tokenAddress, LIQUIDMESH_ROUTER);
    if (!g.enabled) {
      return {
        paused: null,
        reason: "token not configured in ShareGuard",
        observedAt,
      };
    }
    if (g.tokenPaused === undefined) {
      return {
        paused: null,
        reason: "pause check reverted",
        observedAt,
      };
    }
    return {
      paused: g.tokenPaused,
      reason: null,
      observedAt,
    };
  } catch {
    return {
      paused: null,
      reason: "guard read failed; details withheld",
      observedAt,
    };
  }
}
