import { parseAbi } from "viem";
import type { Address, Issuer } from "@tally/core";
import type { BscClient } from "./client";

/** bStock `uiMultiplier()` 0xa60bf13d and xStocks `multiplier()` 0x1b3ed722, both 1e18 fixed point (blueprint §7.3). Ondo has none onchain. */
export const MULTIPLIER_ABI = parseAbi([
  "function uiMultiplier() view returns (uint256)",
  "function multiplier() view returns (uint256)",
]);

export async function readUiMultiplier(client: BscClient, token: Address): Promise<bigint> {
  return client.readContract({ address: token, abi: MULTIPLIER_ABI, functionName: "uiMultiplier" });
}

export async function readMultiplier(client: BscClient, token: Address): Promise<bigint> {
  return client.readContract({ address: token, abi: MULTIPLIER_ABI, functionName: "multiplier" });
}

/** Reader for @tally/binance's facts port: bStock and xStocks are read onchain; Ondo returns undefined (API only). */
export function onchainMultiplierReader(client: BscClient) {
  return async (token: { issuer: Issuer; address: Address }): Promise<bigint | undefined> => {
    if (token.issuer === "bstock") return readUiMultiplier(client, token.address);
    if (token.issuer === "xstocks") return readMultiplier(client, token.address);
    return undefined;
  };
}
