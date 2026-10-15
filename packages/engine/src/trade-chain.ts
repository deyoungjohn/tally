import { BaseError, type Hex, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDT_BSC } from "@tally/config";
import type { Address } from "@tally/core";
import {
  ERC20_ABI,
  RPC_SLOW_MS,
  explorerFromEnv,
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
    blockNumber: () => client.getBlockNumber(),
    async erc20Balances(owner, tokens) {
      // viem splits a multicall into one eth_call per ~1 KB of calldata by default, about 5 balances per call: a scan of the
      // whole registry (675 tokens) then cost over a hundred provider calls. A 100-token chunk fits in one (it is read-only
      // and tiny), so the chunk is sent whole.
      const res = await client.multicall({
        batchSize: 32_768,
        allowFailure: false,
        contracts: tokens.map(
          (address) =>
            ({ address, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] }) as const,
        ),
      });
      return res as bigint[];
    },
    async receipt(txHash) {
      const viaRpc = async () => {
        try {
          return await client.getTransactionReceipt({ hash: txHash });
        } catch (e) {
          // Not mined yet, or a transport hiccup: the caller keeps polling and never loses the hash (blueprint §7.8).
          if (e instanceof Error && /not.*found|could not be found/i.test(e.message)) return null;
          throw e;
        }
      };
      const explorer = explorerFromEnv();
      if (!explorer) return viaRpc();
      // The RPC first. When it is slow, fails, or has not seen the transaction, the explorer is asked too, so a confirmed
      // transaction is never shown as pending just because one provider lagged.
      let slow: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"slow">((r) => {
        slow = setTimeout(() => r("slow"), RPC_SLOW_MS);
      });
      const attempt = viaRpc().then(
        (v) => ({ ok: true as const, v }),
        (e: unknown) => ({ ok: false as const, e }),
      );
      const winner = await Promise.race([attempt, timeout]);
      clearTimeout(slow);
      if (winner !== "slow" && winner.ok && winner.v !== null) return winner.v;
      const ex = await explorer.receipt(txHash).catch(() => null);
      // Same fields the guard decoder and the fee maths read; the explorer returns them in the same shape.
      if (ex) return ex as unknown as TransactionReceipt;
      if (winner === "slow") {
        const late = await attempt;
        if (late.ok) return late.v;
        throw late.e;
      }
      if (winner.ok) return winner.v;
      throw winner.e;
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
