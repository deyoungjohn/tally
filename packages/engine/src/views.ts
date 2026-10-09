import { TtlCache, inspectTicker, type EnginePorts, type TokenInspection } from "@tally/core";
import type { Address } from "@tally/core";
import type { TradeChain } from "./trade";

const E18 = 1e18;

export interface RadarRow {
  ticker: string;
  symbol: string;
  issuer: "ondo" | "bstock" | "xstocks";
  address: Address;
  executable: boolean;
  /** Plain-English reason when the token is not buyable. */
  reason?: string;
  /** Shares per token. */
  multiplier?: number;
  grade: "A" | "B" | "C" | "D" | "F";
  flags: string[];
  /** Deductions and flags in plain English. */
  reasons: string[];
  volume24hUsd?: number;
  status?: string;
  unitTrap: boolean;
}

export interface RadarReport {
  asOf: string;
  rows: RadarRow[];
  /** Tickers whose data could not be read, with why. Never silently dropped. */
  failed: { ticker: string; message: string }[];
}

const toRow = (ticker: string, t: TokenInspection): RadarRow => ({
  ticker,
  symbol: t.symbol,
  issuer: t.issuer,
  address: t.address,
  executable: t.executable,
  reason: t.blockedReason,
  multiplier: t.multiplier ? Number(t.multiplier.value) / E18 : undefined,
  grade: t.integrity.grade,
  flags: t.integrity.flags,
  reasons: t.integrity.reasons.map((r) => r.reason ?? r.summary),
  volume24hUsd: t.facts.onchainVolume24hUsd,
  status: t.facts.status?.kind,
  unitTrap: t.integrity.unitTrap,
});

/** Runs an async mapper over items with at most `limit` tasks running concurrently, preserving item order. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const max = Math.max(1, limit);
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(max, items.length) }, async () => {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx]!, idx);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Trap radar: every token of the given tickers with its integrity grade (blueprint §7.5). Bounded concurrency of 4 at a time. */
export function radarFor(
  ports: EnginePorts,
  now: () => number,
  ttlMs = 120_000,
  inspect?: (ticker: string) => Promise<TokenInspection[]>,
) {
  const cache = new TtlCache<RadarReport>(ttlMs, now);
  const doInspect = inspect ?? ((t: string) => inspectTicker(ports, t));
  return (tickers: readonly string[]) =>
    cache.get(tickers.join(","), async () => {
      const rows: RadarRow[] = [];
      const failed: RadarReport["failed"] = [];
      const inspected = await mapConcurrent(tickers, 4, async (t) => {
        try {
          const toks = await doInspect(t);
          return { ticker: t, toks };
        } catch (e) {
          return {
            ticker: t,
            error: e instanceof Error ? e.message.slice(0, 160) : String(e),
          };
        }
      });
      for (const item of inspected) {
        if (item.error) {
          failed.push({ ticker: item.ticker, message: item.error });
        } else if (item.toks) {
          for (const tok of item.toks) rows.push(toRow(item.ticker, tok));
        }
      }
      return { asOf: new Date(now()).toISOString(), rows, failed };
    });
}

export interface Holding {
  ticker: string;
  symbol: string;
  issuer: "ondo" | "bstock" | "xstocks";
  address: Address;
  /** Token units held. */
  tokens: number;
  /** Shares per token. */
  multiplier: number;
  /** tokens × multiplier: the number that matters. */
  shares: number;
  valueUsd: number | null;
  grade: RadarRow["grade"];
}

export interface PortfolioReport {
  address: Address;
  asOf: string;
  /** Holdings across issuers, grouped by ticker (shares add up across issuers). */
  groups: {
    ticker: string;
    shares: number;
    valueUsd: number | null;
    referencePrice: number | null;
    parts: Holding[];
  }[];
  totalValueUsd: number;
  wallet: { usdt: number; bnb: number };
  failed: { ticker: string; message: string }[];
  /** Observability counts (non-enumerable on returned instance to preserve byte-identical serialization). */
  stats?: {
    inspected: number;
    cacheHits: number;
  };
}

export interface WalletToken {
  ticker: string;
  symbol: string;
  issuer: "ondo" | "bstock" | "xstocks";
  /** Registry address (never user input): the only addresses the Send form can transfer. */
  address: Address;
  decimals: number;
  /** Raw balance as a decimal string (bigint does not survive JSON). */
  balanceRaw: string;
}

export interface HoldingsReport {
  address: Address;
  asOf: string;
  /** Every tokenized stock in the registry that the wallet holds (balance above zero), whichever issuer or ticker. */
  tokens: WalletToken[];
  failed: { symbol: string; message: string }[];
}

/** Balances for a list of tokens; a chunk that fails is split until the single failing token is found, which is reported, not hidden. */
async function balancesBisect(
  chain: TradeChain,
  owner: Address,
  tokens: Address[],
  out: Map<string, bigint>,
  failed: Map<string, string>,
): Promise<void> {
  if (tokens.length === 0) return;
  try {
    const res = await chain.erc20Balances(owner, tokens);
    tokens.forEach((t, i) => out.set(t, res[i] ?? 0n));
  } catch (e) {
    if (tokens.length === 1) {
      failed.set(tokens[0]!, e instanceof Error ? e.message.slice(0, 160) : String(e));
      return;
    }
    const mid = Math.ceil(tokens.length / 2);
    await balancesBisect(chain, owner, tokens.slice(0, mid), out, failed);
    await balancesBisect(chain, owner, tokens.slice(mid), out, failed);
  }
}

/** Every registry token the wallet holds, for the Send form. Needs a registry that can list all tokens. */
export async function holdingsFor(
  ports: EnginePorts,
  chain: TradeChain,
  address: Address,
  now: () => number,
): Promise<HoldingsReport> {
  if (!ports.registry.all) throw new Error("This registry cannot list every token.");
  const all = await ports.registry.all();
  const out = new Map<string, bigint>();
  const failed = new Map<string, string>();
  const CHUNK = 100;
  for (let i = 0; i < all.length; i += CHUNK)
    await balancesBisect(
      chain,
      address,
      all.slice(i, i + CHUNK).map((t) => t.address),
      out,
      failed,
    );
  return {
    address,
    asOf: new Date(now()).toISOString(),
    tokens: all
      .filter((t) => (out.get(t.address) ?? 0n) > 0n)
      .map((t) => ({
        ticker: t.ticker,
        symbol: t.symbol,
        issuer: t.issuer,
        address: t.address,
        decimals: t.decimals,
        balanceRaw: String(out.get(t.address)),
      })),
    failed: all
      .filter((t) => failed.has(t.address))
      .map((t) => ({ symbol: t.symbol, message: failed.get(t.address)! })),
  };
}

/** Portfolio in shares (blueprint §11): balanceOf for every registry token of the given tickers × its resolved multiplier. */
export async function portfolioFor(
  ports: EnginePorts,
  chain: TradeChain,
  address: Address,
  tickers: readonly string[],
  now: () => number,
  inspect?: (
    ticker: string,
  ) => Promise<{ toks: TokenInspection[]; cached?: boolean } | TokenInspection[]>,
): Promise<PortfolioReport> {
  const balPromise = chain.balances(address);
  const doInspect =
    inspect ?? (async (t: string) => ({ toks: await inspectTicker(ports, t), cached: false }));

  let inspectedCount = 0;
  let cacheHitsCount = 0;

  const inspectedResults = await mapConcurrent(tickers, 4, async (ticker) => {
    try {
      const res = await doInspect(ticker);
      const toks = Array.isArray(res) ? res : res.toks;
      const isCached = !Array.isArray(res) && Boolean(res.cached);
      if (isCached) {
        cacheHitsCount++;
      } else {
        inspectedCount++;
      }
      return { ticker, toks };
    } catch (e) {
      inspectedCount++;
      return {
        ticker,
        error: e instanceof Error ? e.message.slice(0, 160) : String(e),
      };
    }
  });

  const failed: PortfolioReport["failed"] = [];
  const successful: { ticker: string; toks: TokenInspection[] }[] = [];
  for (const item of inspectedResults) {
    if (item.error) {
      failed.push({ ticker: item.ticker, message: item.error });
    } else if (item.toks) {
      successful.push({ ticker: item.ticker, toks: item.toks });
    }
  }

  // One erc20Balances call for all the tokens of all inspected tickers instead of one per ticker
  const allTokenAddresses = successful.flatMap((s) => s.toks.map((t) => t.address));
  const balances =
    allTokenAddresses.length > 0 ? await chain.erc20Balances(address, allTokenAddresses) : [];
  const balanceMap = new Map<string, bigint>();
  allTokenAddresses.forEach((addr, i) => {
    balanceMap.set(addr.toLowerCase(), balances[i] ?? 0n);
  });

  const groups: PortfolioReport["groups"] = [];
  for (const s of successful) {
    const ref = s.toks[0]?.referencePrice?.price ?? null;
    const parts: Holding[] = [];
    s.toks.forEach((t) => {
      const raw = balanceMap.get(t.address.toLowerCase()) ?? 0n;
      if (raw === 0n || !t.multiplier) return;
      const tokens = Number(raw) / E18;
      const multiplier = Number(t.multiplier.value) / E18;
      const shares = tokens * multiplier;
      parts.push({
        ticker: s.ticker,
        symbol: t.symbol,
        issuer: t.issuer,
        address: t.address,
        tokens,
        multiplier,
        shares,
        valueUsd: ref === null ? null : shares * ref,
        grade: t.integrity.grade,
      });
    });
    if (parts.length === 0) continue;
    const shares = parts.reduce((a, p) => a + p.shares, 0);
    groups.push({
      ticker: s.ticker,
      shares,
      valueUsd: ref === null ? null : shares * ref,
      referencePrice: ref,
      parts,
    });
  }

  const bal = await balPromise;

  const report: PortfolioReport = {
    address,
    asOf: new Date(now()).toISOString(),
    groups,
    totalValueUsd: groups.reduce((a, g) => a + (g.valueUsd ?? 0), 0),
    wallet: { usdt: Number(bal.usdt) / E18, bnb: Number(bal.bnb) / E18 },
    failed,
  };

  Object.defineProperty(report, "stats", {
    value: { inspected: inspectedCount, cacheHits: cacheHitsCount },
    enumerable: false,
    writable: true,
    configurable: true,
  });

  return report;
}
