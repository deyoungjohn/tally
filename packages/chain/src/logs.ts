import { createPublicClient, http, type Address, type Hash, type PublicClient } from "viem";
import { bsc } from "viem/chains";

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export interface TransferLog {
  address: string;
  topics: readonly string[];
  data: string;
  transactionHash: string;
  blockNumber: bigint;
  logIndex: number;
  timestampMs: number;
  removed?: boolean;
}
export interface FlowReceipt {
  transactionHash: string;
  status: "success" | "reverted";
  logs: readonly Pick<TransferLog, "address" | "topics" | "data" | "logIndex">[];
}
export interface FlowChain {
  blockNumber(): Promise<bigint>;
  transferLogs(token: string, fromBlock: bigint, toBlock: bigint): Promise<TransferLog[]>;
  transactionReceipt(hash: string): Promise<FlowReceipt>;
}

/** Explicit failover avoids leaking viem's provider URL in errors or warning causes. */
export function flowChainFromClients(
  clients: readonly PublicClient[],
  onWarn: (message: string) => void = (message) => console.warn(message),
): FlowChain {
  const run = async <T>(name: string, read: (client: PublicClient) => Promise<T>): Promise<T> => {
    for (let i = 0; i < clients.length; i++) {
      try {
        return await read(clients[i]!);
      } catch {
        onWarn(`Chain provider ${i + 1} failed during ${name}; provider details withheld`);
      }
    }
    throw new Error(`No configured chain provider answered ${name}`);
  };
  return {
    blockNumber: () => run("block number", (client) => client.getBlockNumber({ cacheTime: 0 })),
    async transferLogs(token, fromBlock, toBlock) {
      if (fromBlock < 0n || toBlock < fromBlock || toBlock - fromBlock + 1n > 10_000n)
        throw new RangeError("Transfer window must contain 1..10000 blocks");
      if (!/^0x[0-9a-fA-F]{40}$/.test(token)) throw new Error("Invalid token address");
      return run("Transfer logs", async (client) => {
        const logs = await client.request({
          method: "eth_getLogs",
          params: [
            {
              address: token as Address,
              fromBlock: `0x${fromBlock.toString(16)}`,
              toBlock: `0x${toBlock.toString(16)}`,
              topics: [TRANSFER_TOPIC],
            },
          ],
        });
        const times = new Map<bigint, number>();
        const result: TransferLog[] = [];
        for (const log of logs) {
          if (log.topics[0] !== TRANSFER_TOPIC || log.removed) continue;
          if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null)
            throw new Error("Unmined log");
          const blockNumber = BigInt(log.blockNumber);
          if (!times.has(blockNumber)) {
            // NodeReal supplies this extension; Ankr can require a block header read.
            const timestamp = (log as typeof log & { blockTimestamp?: string }).blockTimestamp;
            if (timestamp && /^0x[0-9a-fA-F]+$/.test(timestamp))
              times.set(blockNumber, Number(BigInt(timestamp)) * 1000);
            else {
              const block = await client.getBlock({ blockNumber });
              times.set(blockNumber, Number(block.timestamp) * 1000);
            }
          }
          result.push({
            address: log.address,
            topics: log.topics,
            data: log.data,
            transactionHash: log.transactionHash,
            blockNumber,
            logIndex: Number(BigInt(log.logIndex)),
            timestampMs: times.get(blockNumber)!,
            removed: log.removed,
          });
        }
        return result;
      });
    },
    transactionReceipt: (hash) =>
      run("transaction receipt", async (client) => {
        if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Invalid transaction hash");
        const receipt = await client.getTransactionReceipt({ hash: hash as Hash });
        return {
          transactionHash: receipt.transactionHash,
          status: receipt.status,
          logs: receipt.logs.map((log) => ({
            address: log.address,
            topics: log.topics,
            data: log.data,
            logIndex: log.logIndex,
          })),
        };
      }),
  };
}

export function flowChainFromEnv(
  env: Record<string, string | undefined> = process.env,
  onWarn?: (message: string) => void,
): FlowChain {
  const providers = [
    [env.BSC_RPC_NODEREAL ?? env.BSC_RPC_PRIMARY, "https://bsc-mainnet.nodereal.io/v1/"],
    [
      env.BSC_RPC_ANKR ??
        env.BSC_RPC_FALLBACKS?.split(",")
          .map((value) => value.trim())
          .find(Boolean),
      "https://rpc.ankr.com/bsc/",
    ],
  ] as const;
  const clients = providers
    .filter(([value]) => Boolean(value))
    .map(([value, prefix]) =>
      createPublicClient({
        chain: bsc,
        transport: http(/^https?:\/\//.test(value!) ? value : prefix + value, {
          timeout: 15_000,
          retryCount: 1,
        }),
      }),
    );
  if (!clients.length)
    (onWarn ?? console.warn)(
      "Flow chain reader has no configured provider; chain fallback unavailable",
    );
  // Construction stays additive: quotes still work when no logs provider is configured.
  return flowChainFromClients(clients, onWarn);
}
