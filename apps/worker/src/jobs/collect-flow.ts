import {
  collectorRecording,
  type MarketHolder,
  type MarketLiquidity,
  type RwaToken,
} from "@tally/binance";
import { errorMessage, withFallback } from "@tally/modkit";
import {
  classifyTrade,
  classifyChainLogs,
  labelWallet,
  aggregateFlow,
  ghostInput,
  checkGhost,
  fixed,
  priceWhaleFromReceipt,
  WHALE_USD,
  WINDOWS,
  FLOW_MAX_AGE_MS,
  type FlowToken,
  type FlowSnapshot,
  type FlowTrade,
  type PoolInput,
  type LabelLists,
} from "@tally/mod-flow";
import type { WorkerContext, WorkerJob } from "../runner";

export interface RadarSnapshotRow {
  ticker: string;
  address: string;
  symbol: string;
  issuer: FlowToken["issuer"];
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  reasons: string[];
  ghost: boolean;
  ghostPoints: number;
  ghostReasons: string[];
  totalDeductions: number;
}
interface Progress {
  lastBlock?: bigint;
  cursor?: string;
  coverageStartMs: number | null;
  latestPollAt?: number;
}
export interface CollectFlowOptions {
  tokens?: readonly FlowToken[];
  maxPages?: number;
  lists?: LabelLists;
  fixture?: boolean;
}
const ROUTERS = ["0xb44446b0c8e56988c34f7ff73ae904982b5fdda5"];
const keyFor = (token: FlowToken) => token.address.toLowerCase();

/** Optional metadata uses a last-good snapshot with its original age; missing facts always explain why. */
async function metadata<T>(
  ctx: WorkerContext,
  kind: string,
  token: FlowToken,
  read: () => Promise<T>,
  fixture: boolean,
): Promise<{ data: T | null; reason: string | null }> {
  const key = keyFor(token);
  const previous = ctx.store.latest<T>(kind, key, { maxAgeMs: 600_000, now: ctx.now() });
  if (previous && !previous.stale) return { data: previous.data, reason: null };
  try {
    const data = await read();
    const prefix = {
      "flow-holders": "F_holder",
      "flow-traders": "F_top_trader",
      "flow-pools": "F_top_liquidity",
    }[kind];
    const observedAt = fixture
      ? collectorRecording(`${prefix}_${token.symbol}`).observedAt
      : ctx.now();
    ctx.store.put({ kind, key, data, observedAt, source: fixture ? "fixture" : "binance" });
    const age = Math.max(0, ctx.now() - observedAt);
    return { data, reason: age > 600_000 ? `${kind} metadata is stale (${age} ms old)` : null };
  } catch (error) {
    const reason = `${kind} unavailable: ${errorMessage(error)}`;
    ctx.onWarn(reason);
    return {
      data: previous?.data ?? null,
      reason: previous ? `${reason}; using ${previous.ageMs} ms old metadata` : reason,
    };
  }
}

async function resolveTokens(ctx: WorkerContext): Promise<FlowToken[]> {
  const registry = ctx.store.latest<RwaToken[]>("registry", "bsc", {
    maxAgeMs: 60_000,
    now: ctx.now(),
  });
  if (!registry) throw new Error("No registry snapshot; start collect-registry first");
  if (registry.stale)
    ctx.onWarn(`Using stale registry (${registry.ageMs} ms old) for flow discovery`);
  const tokens: FlowToken[] = [];
  const radarTokens: FlowToken[] = [];
  // Engine's public registry expands every discovered ticker to all issuers, including xStocks.
  for (const ticker of [...new Set(registry.data.map((r) => r.underlyingTicker))]) {
    ctx.signal?.throwIfAborted();
    try {
      const rows = await ctx.engine.facts(ticker);
      for (const row of rows) {
        radarTokens.push({
          ticker,
          address: row.address,
          symbol: row.symbol,
          issuer: row.issuer,
          multiplier: row.multiplier?.value ?? 0n,
        });
        ctx.store.put<RadarSnapshotRow>({
          kind: "radar",
          key: row.address,
          source: "engine",
          observedAt: ctx.now(),
          data: {
            ticker,
            address: row.address,
            symbol: row.symbol,
            issuer: row.issuer,
            score: row.integrity.score,
            totalDeductions: row.integrity.checks.reduce((sum, c) => sum + c.points, 0),
            grade: row.integrity.grade,
            reasons: row.integrity.reasons.map((r) => r.reason ?? r.summary),
            ghost: row.integrity.flags.includes("ghost"),
            ghostReasons: row.integrity.reasons
              .filter((r) => r.flag === "ghost")
              .map((r) => r.reason ?? r.summary),
            ghostPoints: row.integrity.checks
              .filter((c) => c.flag === "ghost")
              .reduce((s, c) => s + c.points, 0),
          },
        });
        if (!row.multiplier) {
          ctx.onWarn(`Flow ${row.symbol}: share multiplier unavailable`);
          continue;
        }
        tokens.push({
          ticker,
          address: row.address,
          symbol: row.symbol,
          issuer: row.issuer,
          multiplier: row.multiplier.value,
        });
      }
    } catch (error) {
      ctx.onWarn(`Flow ticker ${ticker} facts unavailable: ${errorMessage(error)}`);
    }
  }
  // A missing multiplier can hide flow, but must never hide that token's grade.
  ctx.store.put({
    kind: "radar-registry",
    key: "bsc",
    source: "engine",
    observedAt: ctx.now(),
    data: radarTokens,
  });
  if (!tokens.length) throw new Error("No flow tokens with a resolved multiplier");
  ctx.store.put({
    kind: "flow-registry",
    key: "bsc",
    source: "engine",
    observedAt: ctx.now(),
    data: tokens,
  });
  return tokens;
}

/** The shared engine BinanceClient owns pacing/retries; this job never constructs a client. */
export async function collectFlow(
  ctx: WorkerContext,
  options: CollectFlowOptions = {},
): Promise<void> {
  const fixture = options.fixture ?? process.env.TALLY_FIXTURES === "1";
  if (
    options.maxPages !== undefined &&
    (!Number.isInteger(options.maxPages) || options.maxPages < 1)
  )
    throw new RangeError("maxPages must be a positive integer");
  const tokens = options.tokens ?? (await resolveTokens(ctx));
  let receiptBudget = 20;
  let failures = 0;
  for (const token of tokens) {
    ctx.signal?.throwIfAborted();
    const key = keyFor(token),
      now = ctx.now();
    const prior = ctx.store.latest<FlowSnapshot>("flow", key, { maxAgeMs: FLOW_MAX_AGE_MS, now });
    const progress = ctx.store.latest<Progress>("flow-progress", key, {
      maxAgeMs: FLOW_MAX_AGE_MS,
      now,
    })?.data;
    const holders = await metadata<MarketHolder[]>(
      ctx,
      "flow-holders",
      token,
      () => ctx.engine.collectors.holders(key),
      fixture,
    );
    const traders = await metadata<MarketHolder[]>(
      ctx,
      "flow-traders",
      token,
      () => ctx.engine.collectors.topTraders(key),
      fixture,
    );
    const pools = await metadata<MarketLiquidity[]>(
      ctx,
      "flow-pools",
      token,
      () => ctx.engine.collectors.topLiquidity(key),
      fixture,
    );
    const lists = { ...options.lists, routers: [...ROUTERS, ...(options.lists?.routers ?? [])] };
    const notes = [holders.reason, traders.reason, pools.reason].filter(
      (r): r is string => r !== null,
    );
    const labels = { ...(prior?.data.labels ?? {}) };
    for (const row of [...(holders.data ?? []), ...(traders.data ?? [])]) {
      const label = labelWallet(row, lists),
        address = row.holderWalletAddress.toLowerCase();
      const previous = labels[address];
      labels[address] = {
        bot: label.bot || (previous?.bot ?? false),
        custody: label.custody || (previous?.custody ?? false),
        reasons: [...new Set([...(previous?.reasons ?? []), ...label.reasons])],
      };
    }
    try {
      const result = await withFallback(
        [
          {
            name: "binance",
            run: async () => {
              const trades: FlowTrade[] = [];
              let cursor: string | undefined;
              let coverageStartMs: number | null = null;
              const maxPages = options.maxPages ?? 10;
              const seen = new Set<string>();
              let observedAt = now;
              for (let pageNo = 0; pageNo < maxPages; pageNo++) {
                ctx.signal?.throwIfAborted();
                const page = await ctx.engine.collectors.trades(key, cursor, 100);
                if (fixture) observedAt = collectorRecording(`F_trades_${token.symbol}`).observedAt;
                for (const raw of page.trades) {
                  const classified = classifyTrade(raw, token);
                  if (classified.trade) trades.push(classified.trade);
                }
                const oldest = page.trades.length
                  ? Math.min(...page.trades.map((t) => t.time))
                  : now;
                const overlap =
                  !cursor &&
                  prior?.source === "binance" &&
                  progress?.latestPollAt !== undefined &&
                  oldest <= progress.latestPollAt;
                if (overlap && progress?.cursor) {
                  // Latest page covers the new tail; continue a previously bounded historical scan.
                  cursor = progress.cursor;
                  continue;
                }
                if (!page.cursor || oldest <= now - WINDOWS["7d"] || overlap) {
                  coverageStartMs = overlap
                    ? progress!.coverageStartMs
                    : page.cursor
                      ? oldest
                      : now - WINDOWS["7d"];
                  cursor = undefined;
                  break;
                }
                if (seen.has(page.cursor)) throw new Error("Trade cursor repeated");
                seen.add(page.cursor);
                cursor = page.cursor;
              }
              if (cursor) notes.push("Trade history incomplete: pagination budget reached");
              return {
                trades,
                coverageStartMs,
                observedAt,
                lastBlock: progress?.lastBlock,
                cursor,
              };
            },
          },
          {
            name: "chain-logs",
            run: async () => {
              const head = await ctx.engine.chain.blockNumber();
              // Live reads lag 12 blocks. The fixture recorder already used a confirmed tip.
              const toBlock = fixture ? head : head > 12n ? head - 12n : 0n;
              const fromBlock =
                progress?.lastBlock === undefined
                  ? toBlock >= 9999n
                    ? toBlock - 9999n
                    : 0n
                  : progress.lastBlock + 1n;
              if (fromBlock > toBlock && prior?.source !== "chain-logs")
                throw new Error("No new confirmed log window; retaining last snapshot");
              const logs = [];
              // Catch up in bounded windows; do not jump the cursor over unread blocks.
              const end = fromBlock + 9999n < toBlock ? fromBlock + 9999n : toBlock;
              if (fromBlock <= end)
                logs.push(...(await ctx.engine.chain.transferLogs(key, fromBlock, end)));
              const classified = classifyChainLogs(
                logs,
                token,
                (pools.data ?? []) as PoolInput[],
                lists,
              );
              if (!pools.data?.length)
                throw new Error("Known pools unavailable; cannot classify chain logs");
              notes.push(...classified.notes);
              const price = ctx.store.latest<{ tokenPrice: string; tokenPriceUpdatedAt: number }>(
                "price",
                key,
                { maxAgeMs: FLOW_MAX_AGE_MS, now },
              );
              const lastPrice = price
                ? (fixed(price.data.tokenPrice) * 10n ** 18n) / token.multiplier
                : null;
              const candidates = classified.trades
                .filter(
                  (t) => lastPrice !== null && (t.shares * lastPrice) / 10n ** 18n >= WHALE_USD,
                )
                .sort((a, b) => (a.shares > b.shares ? -1 : 1));
              const receipts = new Map<
                string,
                Awaited<ReturnType<typeof ctx.engine.chain.transactionReceipt>>
              >();
              for (const trade of candidates) {
                if (receiptBudget <= 0) {
                  notes.push("Whale receipt budget reached (20 per run)");
                  break;
                }
                if (receipts.has(trade.txHash)) continue;
                receiptBudget--;
                try {
                  receipts.set(
                    trade.txHash,
                    await ctx.engine.chain.transactionReceipt(trade.txHash),
                  );
                } catch {
                  const reason = "Whale receipt unavailable; price unavailable from chain logs";
                  notes.push(reason);
                  ctx.onWarn(reason);
                }
              }
              if (lastPrice === null)
                notes.push("Whale threshold unavailable: no last-known price");
              else if (price?.stale)
                notes.push(
                  `Whale size screening uses last-known price (${price.ageMs} ms old); prices come only from receipts`,
                );
              const trades = classified.trades.map((t) =>
                receipts.has(t.txHash)
                  ? priceWhaleFromReceipt(t, receipts.get(t.txHash)!, token)
                  : t,
              );
              const observedAt = logs.length
                ? logs.reduce((last, l) => Math.max(last, l.timestampMs), 0)
                : prior?.source === "chain-logs"
                  ? prior.observedAt
                  : now;
              return {
                trades,
                coverageStartMs: null,
                observedAt,
                lastBlock: fromBlock <= end ? end : progress?.lastBlock,
                cursor: undefined,
              };
            },
          },
        ],
        ctx.onWarn,
      );
      // Avoid double-counting the same execution when the evidence source changes.
      const txs = new Set(result.value.trades.map((t) => t.txHash));
      const old =
        prior?.data.trades.filter(
          (t) => t.at >= now - WINDOWS["7d"] && !(t.source !== result.source && txs.has(t.txHash)),
        ) ?? [];
      const trades = [...new Map([...old, ...result.value.trades].map((t) => [t.id, t])).values()];
      const snapshot: FlowSnapshot = {
        token,
        trades,
        labels,
        holders: holders.data,
        holdersReason: holders.reason,
        coverageStartMs: traders.data && !traders.reason ? result.value.coverageStartMs : null,
        notes: [...new Set(notes)],
      };
      ctx.store.put({
        kind: "flow",
        key,
        data: snapshot,
        observedAt: result.value.observedAt,
        source: result.source,
        notes: snapshot.notes,
      });
      ctx.store.put<Progress>({
        kind: "flow-progress",
        key,
        observedAt: now,
        source: result.source,
        data: {
          lastBlock: result.value.lastBlock,
          cursor: result.value.cursor,
          coverageStartMs: result.value.coverageStartMs,
          latestPollAt: result.value.observedAt,
        },
      });
      const cleaned = aggregateFlow(snapshot, now);
      ctx.store.put({
        kind: "flow-ghost",
        key,
        source: result.source,
        observedAt: result.value.observedAt,
        data: checkGhost(ghostInput(cleaned, now - result.value.observedAt > FLOW_MAX_AGE_MS)),
      });
    } catch (error) {
      failures++;
      ctx.onWarn(
        `Flow ${token.symbol}: both sources failed; retaining snapshot with original age (${errorMessage(error)})`,
      );
    }
  }
  if (failures)
    throw new Error(`${failures} flow token(s) could not update; last snapshots retained`);
}
export const job: WorkerJob = {
  name: "collect-flow",
  intervalMs: 60_000,
  timeoutMs: 1_800_000,
  run: async (ctx) => {
    if (process.env.FEATURE_FLOW === "1") await collectFlow(ctx);
  },
};
