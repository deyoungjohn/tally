import { LIQUIDMESH_ROUTER } from "@tally/config";
import type { Address } from "@tally/core";
import type { TradeChain } from "./trade";

export interface GuardRouterResult {
  routerAllowed: boolean;
  approveTarget: Address;
}

/**
 * Reads whether the allow-listed LiquidMesh router is allowed by ShareGuard for the stock,
 * and what approval spender target ShareGuard requires.
 */
export async function readGuardRouter(
  chain: Pick<TradeChain, "readGuard">,
  stock: Address,
): Promise<GuardRouterResult> {
  const reading = await chain.readGuard(stock, LIQUIDMESH_ROUTER);
  return {
    routerAllowed: reading.routerAllowed,
    approveTarget: reading.approveTarget,
  };
}
