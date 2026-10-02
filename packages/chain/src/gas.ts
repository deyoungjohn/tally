import { BaseError, type Hex } from "viem";
import { gasLimitFromEstimate, TtlCache } from "@tally/core";
import { TTL_MS } from "@tally/config";
import type { Address } from "@tally/core";
import type { BscClient } from "./client";

export interface TxRequest {
  account: Address;
  to: Address;
  data: Hex;
  value?: bigint;
}

export interface GasPlan {
  /** eth_estimateGas result. */
  estimate: bigint;
  /** ceil(estimate × 1.25): what we send. The API's own `gas` (always 450000) is never used (V10). */
  limit: bigint;
}

export async function planGas(client: BscClient, tx: TxRequest): Promise<GasPlan> {
  const estimate = await client.estimateGas({
    account: tx.account,
    to: tx.to,
    data: tx.data,
    value: tx.value,
  });
  return { estimate, limit: gasLimitFromEstimate(estimate) };
}

export type SimulationResult =
  { ok: true; returnData: Hex } | { ok: false; reason: string; revertData?: Hex };

/** eth_call at EXACTLY the gas limit that will be sent (V10): an uncapped dry run hid an out-of-gas revert on mainnet (F6). */
export async function simulateAtLimit(
  client: BscClient,
  tx: TxRequest,
  limit: bigint,
): Promise<SimulationResult> {
  try {
    const r = await client.call({
      account: tx.account,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      gas: limit,
    });
    return { ok: true, returnData: r.data ?? "0x" };
  } catch (e) {
    const base = e instanceof BaseError ? e : undefined;
    const data = (
      base?.walk((x) => typeof (x as { data?: unknown }).data === "string") as { data?: Hex } | null
    )?.data;
    return {
      ok: false,
      reason: base?.shortMessage ?? (e instanceof Error ? e.message : String(e)),
      revertData: data,
    };
  }
}

/** Gas price and BNB price ports for core, cached per blueprint §7.7 (30 s and 60 s). */
export function chainPort(
  client: BscClient,
  bnbUsd: () => Promise<number>,
  now: () => number = Date.now,
) {
  const gas = new TtlCache<bigint>(TTL_MS.gasPrice, now);
  const bnb = new TtlCache<number>(TTL_MS.bnbPrice, now);
  return {
    gasPriceWei: () => gas.get("gas", () => client.getGasPrice()),
    bnbUsd: () => bnb.get("bnb", bnbUsd),
  };
}
