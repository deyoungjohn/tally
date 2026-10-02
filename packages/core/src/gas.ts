import {
  GAS_BY_HOPS,
  GAS_LIMIT_MARGIN_DEN,
  GAS_LIMIT_MARGIN_NUM,
  GAS_PER_EXTRA_HOP,
} from "@tally/config";

/**
 * Expected gas for a route, by hop count, calibrated from real fills (blueprint §7.4 step 7, F6).
 * The API's own `gas` is a constant 450000 and is never used (V10).
 */
export function expectedSwapGas(legCount: number): number {
  const n = Math.max(1, Math.floor(legCount));
  const known = GAS_BY_HOPS[n];
  if (known !== undefined) return known;
  const top = Math.max(...Object.keys(GAS_BY_HOPS).map(Number));
  return GAS_BY_HOPS[top]! + (n - top) * GAS_PER_EXTRA_HOP;
}

/** Display fee in USD: gas × gas price (wei) × BNB price. Labelled "≈" in the UI; the exact number comes from eth_estimateGas at confirm. */
export function feeUsd(gas: number, gasPriceWei: bigint, bnbUsd: number): number {
  return (Number(BigInt(gas) * gasPriceWei) / 1e18) * bnbUsd;
}

/** limit = ceil(estimate × 1.25) (blueprint §7.6 step 5). */
export function gasLimitFromEstimate(estimate: bigint): bigint {
  return (estimate * GAS_LIMIT_MARGIN_NUM + GAS_LIMIT_MARGIN_DEN - 1n) / GAS_LIMIT_MARGIN_DEN;
}
