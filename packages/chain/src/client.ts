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

/**
 * viem's `fallback` transport gives up instead of trying the next endpoint when an error has code -32003 ("transaction
 * rejected"). QuickNode answers a used-up plan with exactly that code ("daily request limit reached"), so on 9 Oct every
 * chain read failed although three public endpoints were configured. A provider that says it is out of quota is a failed
 * endpoint, not a rejected transaction: re-throw it without the code so the next endpoint is tried.
 */
const LIMIT_WORDS = /limit|quota|exceed|upgrade|capacity|too many|rate/i;
export function limitAwareTransport(inner: Transport): Transport {
  return (args) => {
    const t = inner(args);
    return {
      ...t,
      async request(req: Parameters<typeof t.request>[0]) {
        try {
          return await t.request(req);
        } catch (e) {
          const err = e as { code?: number; message?: string; shortMessage?: string };
          const text = `${err.shortMessage ?? ""} ${err.message ?? ""}`;
          if (err.code === -32003 && LIMIT_WORDS.test(text))
            throw Object.assign(
              new Error(
                `RPC provider limit reached: ${text
                  .replace(/https?:\/\/\S+/gi, "<url>")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 160)}`,
              ),
              { name: "ProviderLimitError" },
            );
          throw e;
        }
      },
    };
  };
}

export function createBscClient(o: BscClientOptions = {}): BscClient {
  const urls = [...(o.primary ? [o.primary] : []), ...(o.fallbacks ?? PUBLIC_BSC_RPCS)];
  const transports = (
    o.transports ??
    urls.map((u) => http(u, { timeout: o.timeoutMs ?? 10_000, retryCount: 1, retryDelay: 200 }))
  ).map(limitAwareTransport);
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
