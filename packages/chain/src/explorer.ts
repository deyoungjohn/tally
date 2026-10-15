// The block explorer API as a fallback for chain reads (Etherscan API V2, `chainid=56`, which serves BNB Smart Chain). Our own RPC
// stays first: it is the primary source and the one every number is checked against. When the RPC is slow, down, or has not seen a
// transaction yet, the explorer's `proxy` module answers the same two questions (the transaction and its receipt) from its own
// index, in the same JSON-RPC shape. The key is `ETHERSCAN_API_KEY` (server env only); without it nothing here does anything. The
// key is never logged and never part of an error message. Budget: 5 calls a second and 100,000 a day on the owner's plan; each
// process keeps to 4 a second and 45,000 a day, so the web server and the workers together stay under the plan.

import type { Address, Hex } from "viem";

export interface ExplorerReceipt {
  transactionHash: Hex;
  from: Address;
  to: Address | null;
  blockNumber: bigint;
  gasUsed: bigint;
  effectiveGasPrice: bigint | undefined;
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
export interface ExplorerTransaction {
  hash: Hex;
  from: Address;
  to: Address | null;
  value: bigint;
  input: Hex;
  blockNumber: bigint | null;
  gas: bigint;
}
export interface Explorer {
  receipt(hash: string): Promise<ExplorerReceipt | null>;
  transaction(hash: string): Promise<ExplorerTransaction | null>;
}

const HASH = /^0x[0-9a-fA-F]{64}$/;
const big = (v: unknown): bigint => {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]+$/.test(v)) throw new Error("explorer: bad number");
  return BigInt(v);
};
const hex = (v: unknown): Hex => {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]*$/.test(v)) throw new Error("explorer: bad hex");
  return v as Hex;
};

export function parseReceipt(r: Record<string, unknown>): ExplorerReceipt {
  const status = r.status === "0x1" ? "success" : r.status === "0x0" ? "reverted" : null;
  if (!status) throw new Error("explorer: receipt without a status");
  const logs = Array.isArray(r.logs) ? (r.logs as Record<string, unknown>[]) : [];
  return {
    transactionHash: hex(r.transactionHash),
    from: hex(r.from) as Address,
    to: r.to ? (hex(r.to) as Address) : null,
    blockNumber: big(r.blockNumber),
    gasUsed: big(r.gasUsed),
    effectiveGasPrice:
      typeof r.effectiveGasPrice === "string" ? big(r.effectiveGasPrice) : undefined,
    status,
    logs: logs.map((l) => ({
      address: hex(l.address) as Address,
      topics: (Array.isArray(l.topics) ? l.topics : []).map(hex),
      data: hex(l.data),
      transactionHash: hex(l.transactionHash),
      blockNumber: big(l.blockNumber),
      logIndex: Number(big(l.logIndex)),
      removed: l.removed === true,
    })),
  };
}

export function parseTransaction(t: Record<string, unknown>): ExplorerTransaction {
  return {
    hash: hex(t.hash),
    from: hex(t.from) as Address,
    to: t.to ? (hex(t.to) as Address) : null,
    value: big(t.value),
    input: hex(t.input),
    blockNumber: t.blockNumber ? big(t.blockNumber) : null,
    gas: big(t.gas),
  };
}

export interface ExplorerOptions {
  key: string;
  fetch?: typeof fetch;
  now?: () => number;
  onWarn?: (message: string) => void;
  perSecond?: number;
  perDay?: number;
  timeoutMs?: number;
}

/** A shared client with a spacing limiter and a daily counter. Returns null from a call it may not make (budget spent). */
export function createExplorer(o: ExplorerOptions): Explorer {
  const f = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const warn = o.onWarn ?? console.warn;
  const gap = 1000 / (o.perSecond ?? 4);
  const perDay = o.perDay ?? 45_000;
  let nextAt = 0;
  let day = Math.floor(now() / 86_400_000);
  let used = 0;
  let spentWarned = false;

  async function call(action: string, hash: string): Promise<Record<string, unknown> | null> {
    if (!HASH.test(hash)) throw new Error("Invalid transaction hash");
    const today = Math.floor(now() / 86_400_000);
    if (today !== day) {
      day = today;
      used = 0;
      spentWarned = false;
    }
    if (used >= perDay) {
      if (!spentWarned)
        warn("Explorer daily budget spent; explorer fallback paused until tomorrow");
      spentWarned = true;
      return null;
    }
    used++;
    const wait = Math.max(0, nextAt - now());
    nextAt = Math.max(now(), nextAt) + gap;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const url = `https://api.etherscan.io/v2/api?chainid=56&module=proxy&action=${action}&txhash=${hash}&apikey=${encodeURIComponent(o.key)}`;
    let body: unknown;
    try {
      const res = await f(url, { signal: AbortSignal.timeout(o.timeoutMs ?? 8_000) });
      body = await res.json();
    } catch {
      // Never include the error: its text can carry the URL, and the URL carries the key.
      warn(`Explorer ${action} failed; details withheld`);
      return null;
    }
    const b = body as { result?: unknown; message?: unknown; status?: unknown } | null;
    if (b && b.result && typeof b.result === "object") return b.result as Record<string, unknown>;
    if (b && typeof b.result === "string" && b.status === "0")
      warn(`Explorer ${action}: ${String(b.result).slice(0, 60)}`);
    return null;
  }

  return {
    async receipt(hash) {
      const r = await call("eth_getTransactionReceipt", hash);
      return r ? parseReceipt(r) : null;
    },
    async transaction(hash) {
      const t = await call("eth_getTransactionByHash", hash);
      return t ? parseTransaction(t) : null;
    },
  };
}

let shared: Explorer | null | undefined;
/** The process-wide explorer, or null when `ETHERSCAN_API_KEY` is not set. */
export function explorerFromEnv(
  env: Record<string, string | undefined> = process.env,
  onWarn: (message: string) => void = console.warn,
): Explorer | null {
  if (env === process.env && shared !== undefined) return shared;
  const key = env.ETHERSCAN_API_KEY?.trim();
  const ex = key ? createExplorer({ key, onWarn }) : null;
  if (env === process.env) shared = ex;
  return ex;
}
