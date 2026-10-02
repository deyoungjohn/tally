/* eslint-disable @typescript-eslint/no-explicit-any -- fixture JSON is untyped by nature */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QUOTE_PLACEHOLDER_WALLET, TTL_MS } from "@tally/config";
import {
  BinanceApi,
  BinanceClient,
  BinanceData,
  PublicApi,
  SNAPSHOT_DIR,
  createFixtureFetch,
  latestRaw,
  type FixtureFetchOptions,
} from "@tally/binance";
import { JsonBaselineStore, baselineFromEnv } from "./baseline";
import { chainPort, clientFromEnv, onchainMultiplierReader } from "@tally/chain";
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

export interface Engine {
  quote(input: QuoteInput): Promise<ConsolidatedQuote>;
  /** Every token of a ticker with its facts, bounds and the full integrity check log, and no quote (`tally facts`). */
  facts(ticker: string): Promise<TokenInspection[]>;
  /** Raw ports, for the trade plan (M3) and tests. */
  ports: EnginePorts;
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
}

function build(o: BuildOptions): Engine {
  const now = o.now ?? Date.now;
  const client = new BinanceClient({
    apiKey: o.apiKey,
    apiSecret: o.apiSecret,
    fetch: o.fetch,
    now,
    ratePerSec: o.ratePerSec,
    burst: o.ratePerSec ? Math.max(3, o.ratePerSec) : undefined,
  });
  const api = new BinanceApi(client);
  const data = new BinanceData({
    api,
    pub: new PublicApi(o.fetch),
    onchain: o.onchain,
    now,
    onWarn: o.onWarn,
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
  return {
    ports,
    facts: (ticker) => inspectTicker(ports, ticker),
    quote: (input) => {
      const amount =
        "usd" in input.amount ? amountBucket(input.amount.usd) : `sh${input.amount.shares}`;
      return quotes.get(`${input.ticker.toUpperCase()}:${amount}:${input.wallet ?? ""}`, () =>
        consolidatedQuote(ports, input),
      );
    },
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
  const rpc = clientFromEnv(env);
  const port = chainPort(rpc, async () => 0); // gas price only; BNB price comes from the API in `build`
  return build({
    apiKey,
    apiSecret,
    onchain: onchainMultiplierReader(rpc),
    gasPriceWei: port.gasPriceWei,
    onWarn,
    baseline: baselineFromEnv(env, onWarn),
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
    fetch: base,
    apiKey: "fixture",
    apiSecret: "fixture",
    onchain,
    gasPriceWei: async () => recordedGasPrice,
    now: o.now ?? (() => FIXTURE_NOW),
    ratePerSec: o.ratePerSec ?? 1000,
    onWarn: o.onWarn,
    baseline: new JsonBaselineStore(), // read-only: fixtures never write
  });
}

export type { Address };
