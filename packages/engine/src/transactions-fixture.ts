import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Transactions } from "@tally/chain";
import type { Hex, Address } from "viem";
interface RawTransaction {
  hash: Hex;
  from: Address;
  to: Address | null;
  value: string;
  input: Hex;
  blockNumber: string | null;
  gas: string;
}
interface RawReceipt {
  transactionHash: Hex;
  from: Address;
  to: Address | null;
  blockNumber: string;
  gasUsed: string;
  status: string;
  logs: {
    address: Address;
    topics: Hex[];
    data: Hex;
    transactionHash: Hex;
    blockNumber: string;
    logIndex: string;
    removed?: boolean;
  }[];
}
interface Recording {
  vectors: Record<
    string,
    {
      txHash: string;
      transaction: { ok: boolean; result?: RawTransaction };
      receipt: { ok: boolean; result?: RawReceipt };
    }
  >;
}
/** Lazy and strictly read-only: recorded real hashes only, no generated fills. */
export function fixtureTransactions(): Transactions {
  let recording: Recording | undefined;
  function vector(hash: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Invalid transaction hash");
    if (!recording) {
      const directory = process.env.TALLY_REPO_ROOT
        ? join(process.env.TALLY_REPO_ROOT, "spike/results")
        : join(dirname(fileURLToPath(import.meta.url)), "../../../spike/results");
      const name = readdirSync(directory)
        .filter((n) => /^receipt_vectors_\d+T\d+Z\.json$/.test(n))
        .sort()
        .at(-1);
      if (!name) throw new Error("No receipt vector recording available");
      recording = JSON.parse(readFileSync(join(directory, name), "utf8")) as Recording;
    }
    return Object.values(recording.vectors).find(
      (v) => v.txHash.toLowerCase() === hash.toLowerCase(),
    );
  }
  return {
    async getTransaction(hash) {
      const v = vector(hash);
      if (!v) return null;
      if (!v.transaction.ok || !v.transaction.result) throw new Error("Transaction not recorded");
      const tx = v.transaction.result;
      return {
        hash: tx.hash,
        sender: tx.from,
        destination: tx.to,
        value: BigInt(tx.value),
        input: tx.input,
        inputSelector: tx.input.slice(0, 10) as Hex,
        blockNumber: tx.blockNumber === null ? null : BigInt(tx.blockNumber),
        gasLimit: BigInt(tx.gas),
      };
    },
    async getReceipt(hash) {
      const v = vector(hash);
      if (!v) return null;
      if (!v.receipt.ok || !v.receipt.result) throw new Error("Receipt not recorded");
      const r = v.receipt.result;
      return {
        hash: r.transactionHash,
        sender: r.from,
        destination: r.to,
        blockNumber: BigInt(r.blockNumber),
        gasUsed: BigInt(r.gasUsed),
        status: r.status === "0x1" ? "success" : "reverted",
        logs: r.logs.map((l) => ({
          ...l,
          blockNumber: BigInt(l.blockNumber),
          logIndex: Number(BigInt(l.logIndex)),
          removed: l.removed ?? false,
        })),
      };
    },
  };
}
