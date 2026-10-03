/** BSC mainnet constants (TALLY_BLUEPRINT.md Appendix B). Tests and docs only; runtime reads the registry. */
export const BSC_CHAIN_ID = 56;
export const USDT_BSC = "0x55d398326f99059fF775485246999027B3197955" as const;
export const USDT_DECIMALS = 18;
/** Binance's "native BNB" pseudo-address, used to price BNB for the fee display. */
export const BNB_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;
export const MIN_ORDER_USDT = 6;
/** LiquidMesh router, also the approve target (blueprint V7). ShareGuard allow-lists it in M2. */
export const LIQUIDMESH_ROUTER = "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5" as const;
/** Placeholder `userWalletAddress` for browse quotes: the spike's fixed ShareGuard fork address (F3: quotes ignore wallet history). */
export const QUOTE_PLACEHOLDER_WALLET = "0xcb634955B8A7DF7B106f7AB47C9759B26206b777" as const;

/** ShareGuard v1, deployed and verified on BSC 2026-10-02 (IDEAS §F11). `SHAREGUARD_ADDRESS` in the server env overrides it. */
export const SHAREGUARD_DEPLOYED = "0x28F6F19bffbF25E36452c78d12090F0bC922970a" as const;

/** Function selectors (blueprint Appendix B). */
export const SELECTORS = {
  uiMultiplier: "0xa60bf13d",
  multiplier: "0x1b3ed722",
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",
} as const;

/** Cache TTLs in milliseconds (blueprint §7.7). */
export const TTL_MS = {
  registry: 60 * 60_000,
  multipliers: 5 * 60_000,
  status: 60_000,
  referencePrice: 15_000,
  quote: 10_000,
  gasPrice: 30_000,
  bnbPrice: 60_000,
} as const;

/** Quote amount buckets in USDT (blueprint §7.7). Other amounts are cached by exact value. */
export const QUOTE_BUCKETS_USDT = [6, 10, 25, 50, 100, 250, 500, 1000] as const;

/** Gas the real routes used or needed, by hop count (blueprint §7.4 step 7, F6). Refine with every fill. */
export const GAS_BY_HOPS: Readonly<Record<number, number>> = {
  1: 440_000,
  2: 600_000,
  3: 780_000,
  4: 1_030_000,
};
export const GAS_PER_EXTRA_HOP = 250_000;
/** Limit sent = estimate × 1.25 (blueprint §7.6 step 5, V10). */
export const GAS_LIMIT_MARGIN_NUM = 125n;
export const GAS_LIMIT_MARGIN_DEN = 100n;

/** Public RWA list `type` values (blueprint §7.2). */
export const PUBLIC_LIST_TYPE = { ondo: 1, xstocks: 2, bstock: 3 } as const;
