import { encodeAbiParameters, encodeEventTopics, type Hex, type TransactionReceipt } from "viem";
import { SHAREGUARD_DEPLOYED, USDT_BSC } from "@tally/config";
import type { Address } from "@tally/core";
import { SHAREGUARD_ABI, type GuardReading } from "@tally/chain";
import type { TradeChain } from "./trade";

/** Pseudo transaction hashes the offline wallet mock returns, so fixture mode can answer receipt polls deterministically. */
export const FIXTURE_APPROVE_HASH =
  "0x00000000000000000000000000000000000000000000000000000000000000a1" as Hex;
export const FIXTURE_SWAP_HASH =
  "0x00000000000000000000000000000000000000000000000000000000000000b2" as Hex;

const NVDAB = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436";
const NVDAON = "0xa9ee28c80f960b889dfbd1902055218cba016f75";
const ROUTER = "0xb44446b0c8e56988c34f7ff73ae904982b5fdda5" as Address;

export interface FixtureWalletState {
  usdt: bigint;
  bnb: bigint;
  allowance: bigint;
  /** Make the guard simulation revert with this custom error (data), to exercise the error UX. */
  simulateRevert?: Hex;
  /** Behave as if the token's pause check says paused. */
  tokenPaused?: boolean;
}

/** What a funded wallet looks like in fixture mode: 12 USDT, 0.005 BNB, nothing approved yet. */
export const fixtureWallet = (): FixtureWalletState => ({
  usdt: 12n * 10n ** 18n,
  bnb: 5n * 10n ** 15n,
  allowance: 0n,
});

/** Guard readings recorded on 2026-10-02 (IDEAS §F11): `sharesPerToken` NVDAB 1.000778, NVDAon 1.001715. */
const SHARES_PER_TOKEN: Record<string, bigint> = {
  [NVDAB]: 1_000_778_223_752_807_865n,
  [NVDAON]: 1_001_715_248_790_000_000n,
};

/**
 * An in-memory trade chain for offline runs and tests. It reads the same shapes as the live one, so the plan code
 * under test is the real code. `state` is mutable: tests change balances, and the approve pseudo-hash raises the allowance.
 */
export function fixtureTradeChain(
  state: FixtureWalletState = fixtureWallet(),
  guard: Address = SHAREGUARD_DEPLOYED,
): TradeChain & { state: FixtureWalletState } {
  return {
    state,
    async readGuard(stock): Promise<GuardReading> {
      const s = stock.toLowerCase();
      const m = SHARES_PER_TOKEN[s];
      return {
        paused: false,
        enabled: m !== undefined,
        source: s === NVDAON ? 2 : 0,
        tokenPaused: state.tokenPaused ?? false,
        sharesPerToken: m,
        sharesPerTokenError: m === undefined ? "fixture: no guard reading for this token" : undefined,
        routerAllowed: true,
        approveTarget: ROUTER,
        feed: { multiplier: m ?? 0n, updatedAt: 1_790_935_427n, validAfter: 1_790_935_379n },
        maxAge: 259_200n,
      };
    },
    allowance: async () => state.allowance,
    balances: async () => ({ usdt: state.usdt, bnb: state.bnb }),
    async estimateGas() {
      return state.simulateRevert
        ? { ok: false as const, reason: "execution reverted", revertData: state.simulateRevert }
        : { ok: true as const, gas: 554_149n };
    },
    async simulate() {
      return state.simulateRevert
        ? { ok: false as const, reason: "execution reverted", revertData: state.simulateRevert }
        : { ok: true as const, returnData: "0x" as Hex };
    },
    gasPriceWei: async () => 50_000_000n,
    async receipt(hash) {
      if (hash === FIXTURE_APPROVE_HASH) {
        state.allowance = 2n ** 255n;
        return base(hash, []);
      }
      if (hash === FIXTURE_SWAP_HASH) return base(hash, [guardedLog(guard)]);
      return null;
    },
  };
}

function guardedLog(guard: Address) {
  const topics = encodeEventTopics({
    abi: SHAREGUARD_ABI,
    eventName: "Guarded",
    args: {
      user: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
      recipient: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
      stock: NVDAON,
    },
  });
  const data = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
    ],
    [
      USDT_BSC,
      6n * 10n ** 18n,
      25_660_879_000_000_000n,
      25_704_894_000_000_000n,
      1_001_715_248_790_000_000n,
      ROUTER,
    ],
  );
  return { address: guard, topics, data };
}

function base(hash: Hex, logs: unknown[]): TransactionReceipt {
  return {
    transactionHash: hash,
    status: "success",
    blockNumber: 125_273_150n,
    gasUsed: 648_385n,
    effectiveGasPrice: 50_000_000n,
    logs,
  } as unknown as TransactionReceipt;
}
