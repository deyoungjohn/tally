/* eslint-disable @typescript-eslint/no-explicit-any -- fixture JSON is untyped by nature */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LIQUIDMESH_ROUTER,
  QUOTE_PLACEHOLDER_WALLET,
  SHAREGUARD_DEPLOYED,
  TTL_MS,
} from "@tally/config";

/** NVDAon: the token whose feed the health check reads (any Ondo asset would do). */
const ONDO_PROBE = "0xa9ee28c80f960b889dfbd1902055218cba016f75" as Address;
import {
  BinanceApi,
  BinanceClient,
  BinanceCollectors,
  createCollectorFixtureFetch,
  BinanceData,
  PublicApi,
  SNAPSHOT_DIR,
  createFixtureFetch,
  latestRaw,
  type FixtureFetchOptions,
} from "@tally/binance";
import { JsonBaselineStore, baselineFromEnv } from "./baseline";
import {
  getTradeReceipt,
  prepareTrade,
  type FeedSigner,
  type TradeChain,
  type TradePlan,
  type TradeReceipt,
  type TradeRequest,
} from "./trade";
import { prepareSell, type SellPlan, type SellRequest } from "./sell";
import { readGuardRouter } from "./guard-router";
import { feedSignerFromEnv, liveTradeChain } from "./trade-chain";
import { fixtureTradeChain } from "./trade-fixture";
import {
  holdingsFor,
  portfolioFor,
  radarFor,
  type HoldingsReport,
  type PortfolioReport,
  type RadarReport,
} from "./views";
import { sharesOf, type SharesReport } from "./shares";
import { pauseState, type PauseStateResult } from "./pause";
import type { Hex } from "viem";
import {
  chainPort,
  clientFromEnv,
  onchainMultiplierReader,
  flowChainFromEnv,
  type FlowChain,
  transactionsFromEnv,
  type Transactions,
} from "@tally/chain";
import { fixtureTransactions } from "./transactions-fixture";
import { fixtureFlowChain } from "./flow-fixture";
import { workerRequestPace, type WorkerRequestPaceOptions } from "./worker-request-pace";
import {
  TtlCache,
  amountBucket,
  consolidatedQuote,
  inspectTicker,
  parseDecimal,
  type Address,
  type ConsolidatedQuote,
  type EnginePorts,
  type QuoteInput,
  type RegistryToken,
  type TokenInspection,
} from "@tally/core";

export interface HealthReport {
  binance: "ok" | "region_block" | "auth" | "error";
  binanceDetail?: string;
  rpcBlock: number | null;
  guard: { address: Address; paused: boolean | null };
  feedSigner: "configured" | "missing";
  /** Age of the guard's stored Ondo multiplier, in hours; the guard refuses Ondo buys past `maxAgeHours` unless a signed update rides along. */
  ondoFeed: { ageHours: number | null; maxAgeHours: number | null };
}

export interface Engine {
  /** Opt-in live worker pacing/cancellation; ordinary web/quote engines keep their existing rate. */
  paceWorkerRequests?: (options: WorkerRequestPaceOptions) => void;
  /** Scheduled read-only calls. Existing trade/quote ports are unchanged. */
  collectors: Pick<
    BinanceCollectors,
    | "registry"
    | "prices"
    | "portfolioOverview"
    | "recentPnl"
    | "tokenLatestPnl"
    | "dexHistory"
    | "trades"
    | "holders"
    | "topTraders"
    | "topLiquidity"
  >;
  /** Read-only flow evidence; independent from the existing trade chain. */
  chain: FlowChain;
  transactions: Transactions;
  quote(input: QuoteInput): Promise<ConsolidatedQuote>;
  /** Every token of a ticker with its facts, bounds and the full integrity check log, and no quote (`tally facts`). */
  facts(ticker: string): Promise<TokenInspection[]>;
  /** The trade plan (blueprint §7.6) and the receipt in shares. Needs the ShareGuard address (`SHAREGUARD_ADDRESS`). */
  trade: {
    guard: Address;
    prepare(req: TradeRequest): Promise<TradePlan>;
    receipt(txHash: Hex, ticker?: string): Promise<TradeReceipt>;
    prepareSell(req: SellRequest): Promise<SellPlan>;
    guardRouter(stock: Address): Promise<{ routerAllowed: boolean; approveTarget: Address }>;
  };
  /** Integrity grades for every token of the given tickers (cached 2 minutes). */
  radar(tickers: readonly string[]): Promise<RadarReport>;
  /** A wallet's holdings in shares across issuers. Read-only: any address works. */
  portfolio(address: Address, tickers: readonly string[]): Promise<PortfolioReport>;
  /** Every tokenized stock token a wallet holds, any ticker and issuer (the Send list). Read-only: any address works. */
  holdings(address: Address): Promise<HoldingsReport>;
  sharesOf(address: Address, tickers?: readonly string[]): Promise<SharesReport>;
  pauseState(tokenAddress: Address): Promise<PauseStateResult>;
  /** What `/api/health` reports: Binance auth and the region detector, RPC height, the guard and the Ondo feed's age (blueprint §14). */
  health(): Promise<HealthReport>;
  /** Raw ports, for tests. */
  ports: EnginePorts;
  /** Shared 30-second TTL cache for inspectTicker results across portfolio, radar, and facts. */
  inspectCache?: TtlCache<TokenInspection[]>;
}

interface BuildOptions {
  fetch?: typeof fetch;
  apiKey: string;
  apiSecret: string;
  onchain: (token: RegistryToken) => Promise<bigint | undefined>;
  gasPriceWei: () => Promise<bigint>;
  now?: () => number;
  /** Fixture runs skip pacing: nothing is hitting a real rate limit. */
  ratePerSec?: number;
  onWarn?: (message: string) => void;
  baseline: JsonBaselineStore;
  guard: Address;
  tradeChain: TradeChain;
  signer?: FeedSigner;
  flowChain: FlowChain;
  transactions: Transactions;
  workerPacing?: boolean;
}

function build(o: BuildOptions): Engine {
  const now = o.now ?? Date.now;
  const pace = o.workerPacing ? workerRequestPace(o.fetch) : undefined;
  const transport = pace?.fetch ?? o.fetch;
  const onWarn = pace
    ? (message: string) => {
        if (!pace.aborted()) o.onWarn?.(message);
      }
    : o.onWarn;
  const client = new BinanceClient({
    apiKey: o.apiKey,
    apiSecret: o.apiSecret,
    fetch: transport,
    now,
    ratePerSec: o.ratePerSec,
    burst: o.ratePerSec ? Math.max(3, o.ratePerSec) : undefined,
  });
  const api = new BinanceApi(client);
  const data = new BinanceData({
    api,
    pub: new PublicApi(transport),
    onchain: o.onchain,
    now,
    onWarn,
    baseline: o.baseline,
  });
  const bnb = new TtlCache<number>(TTL_MS.bnbPrice, now);
  const gas = new TtlCache<bigint>(TTL_MS.gasPrice, now);
  const ports: EnginePorts = {
    ...data.ports,
    chain: {
      gasPriceWei: () => gas.get("gas", o.gasPriceWei),
      bnbUsd: () => bnb.get("bnb", () => data.bnbUsd(QUOTE_PLACEHOLDER_WALLET)),
    },
    now,
  };
  const quotes = new TtlCache<ConsolidatedQuote>(TTL_MS.quote, now);
  const quote = (input: QuoteInput) => {
    const amount =
      "usd" in input.amount ? amountBucket(input.amount.usd) : `sh${input.amount.shares}`;
    return quotes.get(`${input.ticker.toUpperCase()}:${amount}:${input.wallet ?? ""}`, () =>
      consolidatedQuote(ports, input),
    );
  };
  const tradeDeps = {
    guard: o.guard,
    api,
    chain: o.tradeChain,
    quote,
    bnbUsd: ports.chain.bnbUsd,
    reference: (t: string) => ports.facts.reference(t),
    signer: o.signer,
    now,
    onWarn: o.onWarn,
  };
  const health = async (): Promise<HealthReport> => {
    const r: HealthReport = {
      binance: "ok",
      rpcBlock: null,
      guard: { address: o.guard, paused: null },
      feedSigner: o.signer ? "configured" : "missing",
      ondoFeed: { ageHours: null, maxAgeHours: null },
    };
    await Promise.all([
      api.supportedChains().then(
        () => undefined,
        (e: unknown) => {
          const k = (e as { kind?: string }).kind;
          r.binance = k === "region_block" ? "region_block" : k === "auth" ? "auth" : "error";
          r.binanceDetail = e instanceof Error ? e.message : String(e);
        },
      ),
      o.tradeChain.blockNumber().then(
        (n) => void (r.rpcBlock = Number(n)),
        () => undefined,
      ),
      o.tradeChain.readGuard(ONDO_PROBE, LIQUIDMESH_ROUTER).then(
        (g) => {
          r.guard.paused = g.paused;
          r.ondoFeed = {
            ageHours: Math.max(0, (now() / 1000 - Number(g.feed.updatedAt)) / 3600),
            maxAgeHours: Number(g.maxAge) / 3600,
          };
        },
        () => undefined,
      ),
    ]);
    return r;
  };
  const sellDeps = {
    api,
    chain: o.tradeChain,
    quote,
    bnbUsd: ports.chain.bnbUsd,
    reference: (t: string) => ports.facts.reference(t),
    now,
    onWarn: o.onWarn,
  };
  const inspectCache = new TtlCache<TokenInspection[]>(30_000, now);
  const cachedInspect = async (ticker: string) => {
    let loaded = false;
    const toks = await inspectCache.get(ticker.toUpperCase(), async () => {
      loaded = true;
      return inspectTicker(ports, ticker);
    });
    return { toks, cached: !loaded };
  };
  const radar = radarFor(ports, now, 120_000, async (t) => (await cachedInspect(t)).toks);
  return {
    paceWorkerRequests: pace?.configure,
    collectors: new BinanceCollectors(client),
    chain: o.flowChain,
    transactions: o.transactions,
    ports,
    health,
    radar,
    portfolio: (address, tickers) =>
      portfolioFor(ports, o.tradeChain, address, tickers, now, cachedInspect),
    holdings: (address) => holdingsFor(ports, o.tradeChain, address, now),
    sharesOf: (address, tickers) => sharesOf(ports, o.tradeChain, address, tickers, o.onWarn),
    pauseState: (tokenAddress) => pauseState(o.tradeChain, tokenAddress, now),
    trade: {
      guard: o.guard,
      prepare: (req) => prepareTrade(tradeDeps, req),
      receipt: (hash, ticker) => getTradeReceipt(tradeDeps, hash, ticker),
      prepareSell: (req) => prepareSell(sellDeps, req),
      guardRouter: (stock) => readGuardRouter(o.tradeChain, stock),
    },
    facts: (ticker) => inspectCache.get(ticker.toUpperCase(), () => inspectTicker(ports, ticker)),
    quote,
    inspectCache,
  };
}

/** Live engine: must run on the Seoul EC2 (the API refuses US callers, V6). Reads secrets from the server env only. */
export function createLiveEngine(
  env: Record<string, string | undefined> = process.env,
  onWarn?: (m: string) => void,
): Engine {
  const apiKey = env.BINANCE_W3_API_KEY;
  const apiSecret = env.BINANCE_W3_API_SECRET;
  if (!apiKey || !apiSecret)
    throw new Error(
      "BINANCE_W3_API_KEY and BINANCE_W3_API_SECRET are not set. Use --fixtures to run offline, or run this on the Seoul EC2 with the env file loaded.",
    );
  const guard = (env.SHAREGUARD_ADDRESS?.trim() || SHAREGUARD_DEPLOYED) as Address;
  const rpc = clientFromEnv(env);
  const port = chainPort(rpc, async () => 0); // gas price only; BNB price comes from the API in `build`
  return build({
    apiKey,
    apiSecret,
    onchain: onchainMultiplierReader(rpc),
    gasPriceWei: port.gasPriceWei,
    onWarn,
    baseline: baselineFromEnv(env, onWarn),
    guard,
    tradeChain: liveTradeChain(rpc, guard),
    signer: feedSignerFromEnv(env),
    flowChain: flowChainFromEnv(env, onWarn),
    transactions: transactionsFromEnv(env, onWarn),
    workerPacing: true,
  });
}

/** Fixture runs replay "as of" the Seoul recording (2026-10-02 05:26 UTC), so attestation ages and cache expiry are deterministic. */
export const FIXTURE_NOW = Date.UTC(2026, 9, 2, 5, 26, 0);

/** Offline engine: the real client, schemas and error mapping, answering from recorded fixtures. */
export function createFixtureEngine(
  o: Pick<FixtureFetchOptions, "blockRegion"> & {
    now?: () => number;
    onWarn?: (m: string) => void;
    /** Test hook: wrap or replace the fixture fetch (e.g. to make one endpoint fail). */
    fetch?: typeof fetch;
    ratePerSec?: number;
    /** Test and e2e hook: the state of the user's wallet and the guard. Defaults to a funded wallet with allowance. */
    tradeChain?: TradeChain;
    signer?: FeedSigner;
  } = {},
): Engine {
  const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8")) as any;
  const onchainTri = readJson(join(SNAPSHOT_DIR, "onchain_multiplier_tri.json"));
  const swaps = readJson(latestRaw("swap_build"));
  const recordedGasPrice = BigInt(
    Object.values<any>(swaps).find((s) => s.swap?.ok)?.swap.data.tx.gasPrice ?? "50000000",
  );
  // Snapshot on-chain readings (2026-09-30) keyed by ticker and issuer. The registry gives us the ticker.
  const tickerByAddress = new Map<string, string>();
  const base = o.fetch ?? createFixtureFetch({ blockRegion: o.blockRegion });
  const onchain = async (token: RegistryToken) => {
    const v = onchainTri[token.ticker]?.[token.issuer];
    tickerByAddress.set(token.address, token.ticker);
    return typeof v === "number" ? parseDecimal(String(v), 18) : undefined;
  };
  return build({
    fetch: o.blockRegion ? base : createCollectorFixtureFetch(base),
    apiKey: "fixture",
    apiSecret: "fixture",
    onchain,
    gasPriceWei: async () => recordedGasPrice,
    now: o.now ?? (() => FIXTURE_NOW),
    ratePerSec: o.ratePerSec ?? 1000,
    onWarn: o.onWarn,
    baseline: new JsonBaselineStore(), // read-only: fixtures never write
    guard: SHAREGUARD_DEPLOYED,
    tradeChain: o.tradeChain ?? fixtureTradeChain(),
    signer: o.signer,
    flowChain: fixtureFlowChain(),
    transactions: fixtureTransactions(),
  });
}

export type { Address };
export type { FlowChain, FlowReceipt, TransferLog } from "@tally/chain";
export type { SellPlan, SellRequest } from "./sell";
