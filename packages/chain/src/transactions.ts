import {
  createPublicClient,
  http,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type PublicClient,
  type Hex,
  type Address,
} from "viem";
import { bsc } from "viem/chains";

export interface ReadTransaction {
  hash: Hex;
  sender: Address;
  destination: Address | null;
  value: bigint;
  input: Hex;
  inputSelector: Hex;
  blockNumber: bigint | null;
  gasLimit: bigint;
}
export interface ReadReceipt {
  hash: Hex;
  sender: Address;
  destination: Address | null;
  blockNumber: bigint;
  gasUsed: bigint;
  status: "success" | "reverted";
  logs: readonly {
    address: Address;
    topics: readonly Hex[];
    data: Hex;
    transactionHash: Hex;
    blockNumber: bigint;
    logIndex: number;
    removed: boolean;
  }[];
}
export interface Transactions {
  getTransaction(hash: string): Promise<ReadTransaction | null>;
  getReceipt(hash: string): Promise<ReadReceipt | null>;
}

/** Provider exceptions can contain credentials. Only fixed, numbered warnings cross this boundary. */
export function transactionsFromClients(
  clients: readonly PublicClient[],
  onWarn: (message: string) => void = console.warn,
): Transactions {
  async function read<T>(
    hash: string,
    name: string,
    fn: (client: PublicClient, hash: Hex) => Promise<T>,
  ): Promise<T | null> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Invalid transaction hash");
    let missing = false;
    for (let i = 0; i < clients.length; i++) {
      try {
        return await fn(clients[i]!, hash as Hex);
      } catch (error) {
        if (
          error instanceof TransactionNotFoundError ||
          error instanceof TransactionReceiptNotFoundError
        ) {
          missing = true;
          if (i + 1 < clients.length)
            onWarn(`Chain provider ${i + 1} has no ${name}; trying fallback`);
        } else onWarn(`Chain provider ${i + 1} failed during ${name}; provider details withheld`);
      }
    }
    if (missing) return null;
    throw new Error(`No configured chain provider answered ${name}`);
  }
  return {
    getTransaction: (hash) =>
      read(hash, "transaction", async (client, hash) => {
        const tx = await client.getTransaction({ hash });
        return {
          hash: tx.hash,
          sender: tx.from,
          destination: tx.to,
          value: tx.value,
          input: tx.input,
          inputSelector: tx.input.slice(0, 10) as Hex,
          blockNumber: tx.blockNumber,
          gasLimit: tx.gas,
        };
      }),
    getReceipt: (hash) =>
      read(hash, "transaction receipt", async (client, hash) => {
        const receipt = await client.getTransactionReceipt({ hash });
        return {
          hash: receipt.transactionHash,
          sender: receipt.from,
          destination: receipt.to,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          status: receipt.status,
          logs: receipt.logs.map((log) => {
            if (log.transactionHash === null || log.blockNumber === null || log.logIndex === null)
              throw new Error("Unmined receipt log");
            return {
              address: log.address,
              topics: log.topics,
              data: log.data,
              transactionHash: log.transactionHash,
              blockNumber: log.blockNumber,
              logIndex: log.logIndex,
              removed: log.removed,
            };
          }),
        };
      }),
  };
}
export function transactionsFromEnv(
  env: Record<string, string | undefined> = process.env,
  onWarn: (message: string) => void = console.warn,
): Transactions {
  const providers = [
    [env.BSC_RPC_NODEREAL ?? env.BSC_RPC_PRIMARY, "https://bsc-mainnet.nodereal.io/v1/"],
    [
      env.BSC_RPC_ANKR ??
        env.BSC_RPC_FALLBACKS?.split(",")
          .map((v) => v.trim())
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
    onWarn("Transaction reader has no configured provider; chain fallback unavailable");
  return transactionsFromClients(clients, onWarn);
}
