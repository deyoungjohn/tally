import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { FlowChain, FlowReceipt, TransferLog } from "@tally/chain";

interface RawLog {
  address: string;
  topics: string[];
  data: string;
  transactionHash: string;
  blockNumber: string;
  logIndex: string;
  blockTimestamp: string;
  removed?: boolean;
}
interface RawReceipt {
  transactionHash: string;
  status: string;
  logs: RawLog[];
}
interface FlowRecording {
  _meta: { toBlock: number; fromBlock: number; finishedAt: string };
  tokens: Record<string, { address: string; logs: RawLog[]; receipts: Record<string, RawReceipt> }>;
}
let cached: FlowRecording | undefined;
export function readFlowRecording(): FlowRecording {
  if (cached) return cached;
  const directory = join(dirname(fileURLToPath(import.meta.url)), "../../../spike/results");
  const name = readdirSync(directory)
    .filter((n) => /^flow_logs_\d+T\d+Z\.json$/.test(n))
    .sort()
    .at(-1);
  if (!name) throw new Error("No flow log recording available");
  return (cached = JSON.parse(readFileSync(join(directory, name), "utf8")) as FlowRecording);
}
export function fixtureFlowChain(): FlowChain {
  // Lazy loading preserves all existing fixture-engine behaviour when flow is unused.
  return {
    async blockNumber() {
      return BigInt(readFlowRecording()._meta.toBlock);
    },
    async transferLogs(token, fromBlock, toBlock): Promise<TransferLog[]> {
      if (toBlock < fromBlock || toBlock - fromBlock + 1n > 10_000n)
        throw new RangeError("Transfer window must contain 1..10000 blocks");
      const recording = readFlowRecording();
      const row = Object.values(recording.tokens).find(
        (r) => r.address.toLowerCase() === token.toLowerCase(),
      );
      if (!row) throw new Error("Token absent from flow log recording");
      if (
        fromBlock < BigInt(recording._meta.fromBlock) ||
        toBlock > BigInt(recording._meta.toBlock)
      )
        throw new Error("Unrecorded block window");
      return row.logs
        .filter((l) => BigInt(l.blockNumber) >= fromBlock && BigInt(l.blockNumber) <= toBlock)
        .map((l) => ({
          ...l,
          blockNumber: BigInt(l.blockNumber),
          logIndex: Number(BigInt(l.logIndex)),
          timestampMs: Number(BigInt(l.blockTimestamp)) * 1000,
        }));
    },
    async transactionReceipt(hash): Promise<FlowReceipt> {
      const receipt = Object.values(readFlowRecording().tokens)
        .flatMap((r) => Object.values(r.receipts))
        .find((r) => r.transactionHash.toLowerCase() === hash.toLowerCase());
      if (!receipt) throw new Error("Receipt absent from flow log recording");
      return {
        transactionHash: receipt.transactionHash,
        status: receipt.status === "0x1" ? "success" : "reverted",
        logs: receipt.logs.map((l) => ({
          address: l.address,
          topics: l.topics,
          data: l.data,
          logIndex: Number(BigInt(l.logIndex)),
        })),
      };
    },
  };
}
