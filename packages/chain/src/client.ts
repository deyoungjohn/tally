import { createPublicClient, fallback, http, type PublicClient, type Transport } from "viem";
import { bsc } from "viem/chains";

/** Failover order (blueprint §7.8, V14): a dedicated provider first, then public endpoints. publicnode already 403'd the Seoul box once. */
export const PUBLIC_BSC_RPCS = [
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-rpc.publicnode.com",
] as const;

export interface BscClientOptions {
  /** Dedicated provider (NodeReal, Ankr, QuickNode...). Goes first. Secret: comes from the server env, never from the browser. */
  primary?: string;
  /** Replaces the default public list. */
  fallbacks?: readonly string[];
  /** Test hook: use these transports instead of building http ones. */
  transports?: Transport[];
  timeoutMs?: number;
}

export type BscClient = PublicClient;

export function createBscClient(o: BscClientOptions = {}): BscClient {
  const urls = [...(o.primary ? [o.primary] : []), ...(o.fallbacks ?? PUBLIC_BSC_RPCS)];
  const transports =
    o.transports ??
    urls.map((u) => http(u, { timeout: o.timeoutMs ?? 10_000, retryCount: 1, retryDelay: 200 }));
  // rank:false keeps the configured order (dedicated first) instead of probing latency.
  return createPublicClient({
    chain: bsc,
    transport: fallback(transports, { rank: false, retryCount: 1 }),
  }) as BscClient;
}

/** BSC_RPC_PRIMARY / BSC_RPC_FALLBACKS (comma separated) as in the server env file (blueprint §14). */
export function clientFromEnv(env: Record<string, string | undefined> = process.env): BscClient {
  const fallbacks = env.BSC_RPC_FALLBACKS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return createBscClient({
    primary: env.BSC_RPC_PRIMARY || undefined,
    fallbacks: fallbacks?.length ? fallbacks : undefined,
  });
}
