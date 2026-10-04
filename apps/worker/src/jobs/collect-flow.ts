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
  RADAR_MAX_AGE_MS,
  INACTIVE_FACTS_REFRESH_MS,
  selectActiveFlow,
  type Integrity,
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
  integrity: Integrity;
  rawVolume24hUsd: bigint | null;
  flowActive: boolean;
  flowReason: string | null;
}
interface Progress {
  lastBlock?: bigint;
  cursor?: string;
  coverageStartMs: number | null;
  latestPollAt?: number;
  backfillStarted?: boolean;
}
export interface CollectFlowOptions {
  tokens?: readonly FlowToken[];
  maxPages?: number;
  lists?: LabelLists;
  fixture?: boolean;
  budgetMs?: number;
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
  ctx.signal?.throwIfAborted();
  const key = keyFor(token);
  const previous = ctx.store.latest<T>(kind, key, { maxAgeMs: 600_000, now: ctx.now() });
  if (previous && previous.ageMs < 600_000) return { data: previous.data, reason: null };
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

const DISCOVERY_MAX_AGE_MS = 600_000;
const RUN_BUDGET_MS = 45_000;
class RunDeferred extends Error {
  constructor() {
    super("Flow read deferred: run time budget reached");
  }
}
interface Discovery {
  attempts: Record<string, number>;
  resolved: Record<string, number>;
}
interface PortfolioHolding {
  tokenContractAddress: string;
  ticker: string;
  balanceTokens: bigint;
  isRecognized?: boolean;
}
function registeredHoldings(ctx: WorkerContext): PortfolioHolding[] {
  const wallets = new Set(
    ctx.store
      .history<{ address: string }>("wallet:active", "bsc", 0, Number.MAX_SAFE_INTEGER)
      .map((s) => s.data.address.toLowerCase())
      .filter((a) => /^0x[0-9a-f]{40}$/.test(a)),
  );
  const holdings: PortfolioHolding[] = [];
  for (const wallet of wallets) {
    const snapshot =
      ctx.store.latest<{ holdings: PortfolioHolding[] }>("portfolio", wallet, {
        maxAgeMs: INACTIVE_FACTS_REFRESH_MS,
        now: ctx.now(),
      }) ??
      ctx.store.latest<{ holdings: PortfolioHolding[] }>("statement", wallet, {
        maxAgeMs: INACTIVE_FACTS_REFRESH_MS,
        now: ctx.now(),
      });
    if (!snapshot)
      ctx.onWarn("Registered wallet holdings unavailable; active set may be incomplete");
    else {
      if (snapshot.stale) ctx.onWarn("Using stale registered-wallet holdings for flow inclusion");
      holdings.push(
        ...snapshot.data.holdings.filter((h) => h.balanceTokens > 0n && h.isRecognized !== false),
      );
    }
  }
  return holdings;
}
interface RunCounts {
  facts: number;
  trades: number;
  holders: number;
  topTraders: number;
  topLiquidity: number;
  receipts: number;
}
export interface FlowCollectionReport {
  startedAt: number;
  elapsedMs: number;
  budgetMs: number;
  registryTokens: number;
  discoveryPending: number;
  attempted: number;
  updated: string[];
  deferred: number;
  counts: RunCounts;
  pass: {
    startedAt: number;
    elapsedMs: number;
    pending: string[];
    tokenCount: number;
    marketRequests: number;
    factsCalls: number;
    complete: boolean;
  };
}

/** Discovery is incremental; old identities survive failed refreshes with their original grades. */
async function resolveTokens(
  ctx: WorkerContext,
  deadline: number,
  counts: RunCounts,
): Promise<{ tokens: FlowToken[]; pending: number }> {
  const now = ctx.now();
  const cachedFlow = ctx.store.latest<FlowToken[]>("flow-registry", "bsc", {
    maxAgeMs: DISCOVERY_MAX_AGE_MS,
    now,
  });
  const cachedRadar = ctx.store.latest<FlowToken[]>("radar-registry", "bsc", {
    maxAgeMs: DISCOVERY_MAX_AGE_MS,
    now,
  });
  const registry = ctx.store.latest<RwaToken[]>("registry", "bsc", { maxAgeMs: 60_000, now });
  if (!registry) throw new Error("No registry snapshot; start collect-registry first");
  if (registry.stale)
    ctx.onWarn(`Using stale registry (${registry.ageMs} ms old) for flow discovery`);
  const holdings = registeredHoldings(ctx);
  const held = new Set(holdings.map((h) => h.tokenContractAddress.toLowerCase()));
  const tickers = [
    ...new Set([...registry.data.map((r) => r.underlyingTicker), ...holdings.map((h) => h.ticker)]),
  ];
  const discovery = ctx.store.latest<Discovery>("flow-discovery", "bsc", {
    maxAgeMs: DISCOVERY_MAX_AGE_MS,
    now,
  })?.data ?? { attempts: {}, resolved: {} };
  let radarTokens = (cachedRadar?.data ?? []).filter((t) => tickers.includes(t.ticker));
  let tokens = radarTokens.filter((t) => t.multiplier > 0n);
  const activeAddresses = new Set((cachedFlow?.data ?? []).map(keyFor));
  const needsFacts = (ticker: string) => {
    const rows = radarTokens.filter((t) => t.ticker === ticker);
    if (!rows.length)
      return (
        !discovery.resolved[ticker] ||
        ctx.now() - discovery.resolved[ticker]! >= INACTIVE_FACTS_REFRESH_MS
      );
    return rows.some((t) => {
      const refreshMs =
        activeAddresses.has(keyFor(t)) || held.has(keyFor(t))
          ? DISCOVERY_MAX_AGE_MS
          : INACTIVE_FACTS_REFRESH_MS;
      const row = ctx.store.latest<RadarSnapshotRow>("radar", keyFor(t), {
        maxAgeMs: refreshMs,
        now: ctx.now(),
      });
      return (
        !row ||
        row.ageMs >= refreshMs ||
        !row.data.integrity ||
        row.data.rawVolume24hUsd === undefined
      );
    });
  };
  const pending = tickers
    .filter(needsFacts)
    .sort(
      (a, b) => (discovery.attempts[a] ?? 0) - (discovery.attempts[b] ?? 0) || a.localeCompare(b),
    );
  for (const ticker of pending) {
    if (ctx.now() >= deadline) break;
    ctx.signal?.throwIfAborted();
    discovery.attempts[ticker] = ctx.now();
    counts.facts++;
    try {
      const rows = await ctx.engine.facts(ticker);
      tokens = tokens.filter((t) => t.ticker !== ticker);
      radarTokens = radarTokens.filter((t) => t.ticker !== ticker);
      for (const row of rows) {
        const token: FlowToken = {
          ticker,
          address: row.address.toLowerCase(),
          symbol: row.symbol,
          issuer: row.issuer,
          multiplier: row.multiplier?.value ?? 0n,
        };
        const previous = ctx.store.latest<RadarSnapshotRow>("radar", keyFor(token), {
          maxAgeMs: INACTIVE_FACTS_REFRESH_MS,
          now: ctx.now(),
        });
        // A ticker refresh can return active and inactive issuers together. Keep the inactive
        // issuer's own 30-minute observation/age instead of refreshing it on its sibling's cadence.
        if (
          previous?.data.flowActive === false &&
          previous.ageMs < INACTIVE_FACTS_REFRESH_MS &&
          !held.has(keyFor(token))
        ) {
          radarTokens.push(cachedRadar?.data.find((t) => keyFor(t) === keyFor(token)) ?? token);
          continue;
        }
        radarTokens.push(token);
        ctx.store.put<RadarSnapshotRow>({
          kind: "radar",
          key: keyFor(token),
          source: "engine",
          observedAt: ctx.now(),
          data: {
            ticker,
            address: token.address,
            symbol: row.symbol,
            issuer: row.issuer,
            integrity: row.integrity,
            rawVolume24hUsd:
              row.facts.onchainVolume24hUsd === undefined ||
              !Number.isFinite(row.facts.onchainVolume24hUsd)
                ? null
                : fixed(String(row.facts.onchainVolume24hUsd)),
            flowActive: false,
            flowReason: null,
            score: row.integrity.score,
            grade: row.integrity.grade,
            reasons: row.integrity.reasons.map((r) => r.reason ?? r.summary),
            ghost: row.integrity.flags.includes("ghost"),
            totalDeductions: row.integrity.checks.reduce((sum, c) => sum + c.points, 0),
            ghostReasons: row.integrity.reasons
              .filter((r) => r.flag === "ghost")
              .map((r) => r.reason ?? r.summary),
            ghostPoints: row.integrity.checks
              .filter((c) => c.flag === "ghost")
              .reduce((sum, c) => sum + c.points, 0),
          },
        });
        if (row.multiplier && row.multiplier.value > 0n) tokens.push(token);
        else ctx.onWarn(`Flow ${row.symbol}: share multiplier unavailable`);
      }
      discovery.resolved[ticker] = ctx.now();
    } catch (error) {
      ctx.onWarn(`Flow ticker ${ticker} facts unavailable: ${errorMessage(error)}`);
    }
  }
  const remaining = tickers.filter(needsFacts).length;
  const notes = remaining ? [`Flow discovery incomplete: ${remaining} ticker(s) pending`] : [];
  ctx.store.put({
    kind: "flow-discovery",
    key: "bsc",
    source: "engine",
    observedAt: ctx.now(),
    data: discovery,
  });
  const selection = selectActiveFlow(
    radarTokens.map((token) => ({
      token,
      held: held.has(keyFor(token)),
      rawVolume24hUsd:
        ctx.store.latest<RadarSnapshotRow>("radar", keyFor(token), {
          maxAgeMs: RADAR_MAX_AGE_MS,
          now: ctx.now(),
        })?.data.rawVolume24hUsd ?? null,
    })),
  );
  tokens = selection.active;
  for (const token of radarTokens) {
    const row = ctx.store.latest<RadarSnapshotRow>("radar", keyFor(token), {
      maxAgeMs: RADAR_MAX_AGE_MS,
      now: ctx.now(),
    });
    if (row)
      ctx.store.put({
        kind: "radar",
        key: keyFor(token),
        source: row.source,
        observedAt: row.observedAt,
        data: {
          ...row.data,
          flowActive: selection.statuses[keyFor(token)]!.active,
          flowReason: selection.statuses[keyFor(token)]!.reason,
        },
      });
  }
  ctx.store.put({
    kind: "flow-active-set",
    key: "bsc",
    source: "engine",
    observedAt: ctx.now(),
    data: {
      size: tokens.length,
      limit: 60,
      discoveryPending: remaining,
      statuses: selection.statuses,
    },
  });
  // Missing multipliers never hide grades; a partial registry is explicitly marked during startup.
  for (const [kind, data] of [
    ["radar-registry", radarTokens],
    ["flow-registry", tokens],
  ] as const)
    if (
      pending.length ||
      remaining ||
      !cachedFlow ||
      cachedFlow.stale ||
      !cachedRadar ||
      cachedRadar.stale ||
      (kind === "flow-registry" && tokens.map(keyFor).join() !== cachedFlow.data.map(keyFor).join())
    )
      ctx.store.put({ kind, key: "bsc", source: "engine", observedAt: ctx.now(), data, notes });
  if (!radarTokens.length && counts.facts > 0 && remaining > 0)
    throw new Error("Flow discovery has no grade observations; facts unavailable");
  return { tokens, pending: remaining };
}

/** The shared engine BinanceClient owns pacing/retries; this job never constructs a client. */
export async function collectFlow(
  ctx: WorkerContext,
  options: CollectFlowOptions = {},
): Promise<void> {
  const fixture = options.fixture ?? process.env.TALLY_FIXTURES === "1";
  if (
    options.maxPages !== undefined &&
    (!Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 10)
  )
    throw new RangeError("maxPages must be an integer between 1 and 10");
  if (options.tokens && options.tokens.length > 60)
    throw new RangeError("Flow collection is capped at 60 tokens");
  const startedAt = ctx.now();
  const budgetMs = options.budgetMs ?? RUN_BUDGET_MS;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0)
    throw new RangeError("budgetMs must be positive");
  const deadline = startedAt + budgetMs;
  const counts: RunCounts = {
    facts: 0,
    trades: 0,
    holders: 0,
    topTraders: 0,
    topLiquidity: 0,
    receipts: 0,
  };
  // Reserve most of each run for flow, even while the initial registry is still being discovered.
  const discovery = options.tokens
    ? { tokens: [...options.tokens], pending: 0 }
    : await resolveTokens(ctx, startedAt + Math.min(10_000, budgetMs / 3), counts);
  const servicedAt = (token: FlowToken) =>
    ctx.store.latest("flow-attempt", keyFor(token), {
      maxAgeMs: FLOW_MAX_AGE_MS,
      now: ctx.now(),
    })?.observedAt ??
    ctx.store.latest("flow-progress", keyFor(token), {
      maxAgeMs: FLOW_MAX_AGE_MS,
      now: ctx.now(),
    })?.observedAt ??
    0;
  const tokens = discovery.tokens
    .map((token) => ({ token, at: servicedAt(token) }))
    .sort((a, b) => a.at - b.at || keyFor(a.token).localeCompare(keyFor(b.token)))
    .map((r) => r.token);
  const updated: string[] = [];
  let attempted = 0;
  let receiptBudget = 20;
  let failures = 0;
  for (const token of tokens) {
    if (ctx.now() >= deadline) break;
    ctx.signal?.throwIfAborted();
    const key = keyFor(token),
      now = ctx.now();
    const prior = ctx.store.latest<FlowSnapshot>("flow", key, { maxAgeMs: FLOW_MAX_AGE_MS, now });
    const progress = ctx.store.latest<Progress>("flow-progress", key, {
      maxAgeMs: FLOW_MAX_AGE_MS,
      now,
    })?.data;
    attempted++;
    ctx.store.put({ kind: "flow-attempt", key, observedAt: now, source: "engine", data: {} });
    const holders = await metadata<MarketHolder[]>(
      ctx,
      "flow-holders",
      token,
      () => {
        counts.holders++;
        return ctx.engine.collectors.holders(key);
      },
      fixture,
    );
    if (ctx.now() >= deadline) break;
    const traders = await metadata<MarketHolder[]>(
      ctx,
      "flow-traders",
      token,
      () => {
        counts.topTraders++;
        return ctx.engine.collectors.topTraders(key);
      },
      fixture,
    );
    if (ctx.now() >= deadline) break;
    const pools = await metadata<MarketLiquidity[]>(
      ctx,
      "flow-pools",
      token,
      () => {
        counts.topLiquidity++;
        return ctx.engine.collectors.topLiquidity(key);
      },
      fixture,
    );
    if (ctx.now() >= deadline) break;
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
              const initialBackfill = !progress?.backfillStarted;
              let cursor: string | undefined;
              let coverageStartMs = progress?.coverageStartMs ?? null;
              const maxPages = initialBackfill
                ? (options.maxPages ?? 10)
                : progress?.cursor
                  ? 2
                  : 1;
              const seen = new Set<string>();
              let observedAt = now;
              for (let pageNo = 0; pageNo < maxPages; pageNo++) {
                if (ctx.now() >= deadline) {
                  if (pageNo === 0) throw new RunDeferred();
                  break;
                }
                ctx.signal?.throwIfAborted();
                counts.trades++;
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
                if (pageNo === 0 && progress?.cursor && !initialBackfill) {
                  // Exactly one tail page, then at most one saved history page on later runs.
                  if (!overlap) {
                    coverageStartMs = null;
                    notes.push(
                      "Trade history incomplete: tail page does not overlap the previous poll",
                    );
                  }
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
                if (!initialBackfill && pageNo === 0) {
                  // One-page tail never restarts the ten-page history scan. Explain gaps explicitly.
                  coverageStartMs = null;
                  notes.push(
                    "Trade history incomplete: tail page does not overlap the previous poll",
                  );
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
              ctx.signal?.throwIfAborted();
              if (ctx.now() >= deadline) throw new RunDeferred();
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
              if (fromBlock <= end) {
                ctx.signal?.throwIfAborted();
                if (ctx.now() >= deadline) throw new RunDeferred();
                logs.push(...(await ctx.engine.chain.transferLogs(key, fromBlock, end)));
              }
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
                .sort((a, b) => (a.shares > b.shares ? -1 : a.shares < b.shares ? 1 : 0));
              const receipts = new Map<
                string,
                Awaited<ReturnType<typeof ctx.engine.chain.transactionReceipt>>
              >();
              for (const trade of candidates) {
                if (receiptBudget <= 0 || ctx.now() >= deadline) {
                  notes.push(
                    receiptBudget <= 0
                      ? "Whale receipt budget reached (20 per run)"
                      : "Whale receipts deferred: run time budget reached",
                  );
                  break;
                }
                if (receipts.has(trade.txHash)) continue;
                ctx.signal?.throwIfAborted();
                receiptBudget--;
                counts.receipts++;
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
        coverageStartMs: result.value.coverageStartMs,
        cleaningReason:
          traders.data && !traders.reason
            ? null
            : "Top-trader labels unavailable; volume not cleaned",
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
          backfillStarted: result.source === "binance" || progress?.backfillStarted,
        },
      });
      updated.push(key);
      const cleaned = aggregateFlow(snapshot, now);
      ctx.store.put({
        kind: "flow-ghost",
        key,
        source: result.source,
        observedAt: result.value.observedAt,
        data: checkGhost(ghostInput(cleaned, now - result.value.observedAt > FLOW_MAX_AGE_MS)),
      });
    } catch (error) {
      if (
        error instanceof AggregateError &&
        error.errors.some(
          (failure: unknown) => failure instanceof Error && failure.cause instanceof RunDeferred,
        )
      )
        break;
      failures++;
      ctx.onWarn(
        `Flow ${token.symbol}: both sources failed; retaining snapshot with original age (${errorMessage(error)})`,
      );
    }
  }
  const lastPass = ctx.store.latest<FlowCollectionReport>("flow-collection", "bsc", {
    maxAgeMs: FLOW_MAX_AGE_MS,
    now: ctx.now(),
  })?.data.pass;
  const pass =
    lastPass && !lastPass.complete
      ? lastPass
      : {
          startedAt,
          elapsedMs: 0,
          pending: tokens.map(keyFor),
          tokenCount: 0,
          marketRequests: 0,
          factsCalls: 0,
          complete: false,
        };
  const serviced = new Set(updated);
  const known = new Set(tokens.map(keyFor));
  // Include tokens discovered during startup; completed passes reset on the next run.
  const previousKnown = new Set(
    ctx.store
      .latest<FlowToken[]>("flow-pass-registry", "bsc", {
        maxAgeMs: FLOW_MAX_AGE_MS,
        now: ctx.now(),
      })
      ?.data.map(keyFor) ?? [],
  );
  pass.pending = [
    ...new Set([
      ...pass.pending,
      ...tokens.filter((t) => !previousKnown.has(keyFor(t))).map(keyFor),
    ]),
  ].filter((key) => known.has(key) && !serviced.has(key));
  pass.tokenCount = tokens.length;
  pass.marketRequests += counts.trades + counts.holders + counts.topTraders + counts.topLiquidity;
  pass.factsCalls += counts.facts;
  pass.elapsedMs = ctx.now() - pass.startedAt;
  pass.complete = tokens.length > 0 && pass.pending.length === 0;
  ctx.store.put({
    kind: "flow-pass-registry",
    key: "bsc",
    source: "engine",
    observedAt: ctx.now(),
    data: tokens,
  });
  ctx.store.put<FlowCollectionReport>({
    kind: "flow-collection",
    key: "bsc",
    source: "engine",
    observedAt: ctx.now(),
    data: {
      startedAt,
      elapsedMs: ctx.now() - startedAt,
      budgetMs,
      registryTokens: tokens.length,
      discoveryPending: discovery.pending,
      attempted,
      updated,
      deferred: tokens.length - updated.length,
      counts,
      pass,
    },
  });
  if (failures)
    throw new Error(`${failures} flow token(s) could not update; last snapshots retained`);
}
export const job: WorkerJob = {
  name: "collect-flow",
  intervalMs: 60_000,
  timeoutMs: 120_000,
  run: async (ctx) => {
    if (process.env.FEATURE_FLOW === "1") await collectFlow(ctx);
  },
};
