import { BaseError, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDT_BSC } from "@tally/config";
import type { Address } from "@tally/core";
import {
  ERC20_ABI,
  feedUpdateTypedData,
  readGuard,
  simulateAtLimit,
  type BscClient,
  type FeedUpdate,
  type TxRequest,
} from "@tally/chain";
import type { FeedSigner, TradeChain } from "./trade";

/** Live trade reads and calls over the failover client (blueprint §7.8). */
export function liveTradeChain(client: BscClient, guard: Address): TradeChain {
  return {
    readGuard: (stock, router) => readGuard(client, guard, stock, router),
    allowance: (owner) =>
      client.readContract({
        address: USDT_BSC,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [owner, guard],
      }),
    async balances(owner) {
      const [usdt, bnb] = await Promise.all([
        client.readContract({
          address: USDT_BSC,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [owner],
        }),
        client.getBalance({ address: owner }),
      ]);
      return { usdt, bnb };
    },
    async estimateGas(tx: TxRequest) {
      try {
        const gas = await client.estimateGas({ account: tx.account, to: tx.to, data: tx.data });
        return { ok: true as const, gas };
      } catch (e) {
        const base = e instanceof BaseError ? e : undefined;
        const data = (
          base?.walk((x) => typeof (x as { data?: unknown }).data === "string") as {
            data?: Hex;
          } | null
        )?.data;
        return {
          ok: false as const,
          reason: base?.shortMessage ?? (e instanceof Error ? e.message : String(e)),
          revertData: data,
        };
      }
    },
    simulate: (tx, limit) => simulateAtLimit(client, tx, limit),
    gasPriceWei: () => client.getGasPrice(),
    async receipt(txHash) {
      try {
        return await client.getTransactionReceipt({ hash: txHash });
      } catch (e) {
        // Not mined yet, or a transport hiccup: the caller keeps polling and never loses the hash (blueprint §7.8).
        if (e instanceof Error && /not.*found|could not be found/i.test(e.message)) return null;
        throw e;
      }
    },
  };
}

/**
 * The Ondo feed signer. `FEED_SIGNER_PK` is read from the SERVER env only, used to sign bounded multiplier updates
 * (the contract caps each step and checks the signer), and never logged or returned. Returns undefined when unset.
 */
export function feedSignerFromEnv(
  env: Record<string, string | undefined> = process.env,
): FeedSigner | undefined {
  const pk = env.FEED_SIGNER_PK?.trim();
  if (!pk) return undefined;
  const account = privateKeyToAccount(pk.startsWith("0x") ? (pk as Hex) : (`0x${pk}` as Hex));
  return {
    address: account.address as Address,
    signUpdate: (guard: Address, update: FeedUpdate) =>
      account.signTypedData(feedUpdateTypedData(guard, update)),
  };
}

