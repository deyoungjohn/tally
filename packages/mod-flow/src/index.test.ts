import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { E18 } from "@tally/core";
import { openStore } from "@tally/modkit";
import { createFixtureEngine } from "../../engine/src/engine";
import { readFlowRecording } from "../../engine/src/flow-fixture";
import { collectFlow } from "../../../apps/worker/src/jobs/collect-flow";
import type { WorkerContext } from "../../../apps/worker/src/runner";
import {
  aggregateFlow,
  classifyChainLogs,
  classifyTrade,
  checkGhost,
  selectActiveFlow,
  fixed,
  labelWallet,
  priceWhaleFromReceipt,
  TRANSFER_TOPIC,
  WINDOWS,
  type FlowSnapshot,
  type FlowToken,
  type FlowTrade,
  type HolderInput,
  type PoolInput,
  type TradeInput,
} from "./index";

const probes = JSON.parse(
  readFileSync(
    new URL("../../../spike/results/module_probes_20261003T130122Z.json", import.meta.url),
    "utf8",
  ),
) as Record<string, { data: unknown }>;
const trades = (probes.F_trades_NVDAB!.data as { trades: TradeInput[] }).trades;
const holders = probes.F_holder_NVDAB!.data as HolderInput[];
const traders = probes.F_top_trader_NVDAB!.data as HolderInput[];
const pools = probes.F_top_liquidity_NVDAB!.data as PoolInput[];
const token: FlowToken = {
  ticker: "NVDA",
  symbol: "NVDAB",
  address: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
  issuer: "bstock",
  multiplier: fixed("1.000778223752807865"),
};
const now = Date.parse(readFlowRecording()._meta.finishedAt);
function sample(overrides: Partial<FlowSnapshot> = {}): FlowSnapshot {
  return {
    token,
    trades: [],
    holders,
    holdersReason: null,
    labels: {},
    coverageStartMs: now - WINDOWS["7d"],
    notes: [],
    ...overrides,
  };
}

describe("stablecoin classifier", () => {
  it("excludes the recorded NVDAB vs JARVIS trade; USDT price per share is correct within 0.01%", () => {
    const jarvis = trades.find((t) =>
      t.changedTokenInfo.some((l) => (l as { tokenSymbol?: string }).tokenSymbol === "JARVIS"),
    );
    expect(jarvis).toBeDefined();
    expect(classifyTrade(jarvis!, token).trade).toBeNull();
    const usdt = trades.find((t) =>
      t.changedTokenInfo.some(
        (l) => l.tokenContractAddress === "0x55d398326f99059ff775485246999027b3197955",
      ),
    )!;
    const kept = classifyTrade(usdt, token).trade!;
    expect(kept.side).toBe("sell");
    expect(kept.shares).toBe(8516353656556037n);
    expect(kept.usd).toBe(1991926141037700768n);
    const expected = 233.89424880262942; // Independently computed with Python Decimal (60 digits).
    expect(Math.abs(Number(kept.pricePerShare) / 1e18 / expected - 1)).toBeLessThan(0.0001);
  });
  it("identifies stablecoins by address, rejects ambiguous legs, and supports a 10x multiplier", () => {
    const input = trades.find((t) => classifyTrade(t, token).trade)!;
    const one = classifyTrade(input, token).trade!,
      ten = classifyTrade(input, { ...token, multiplier: token.multiplier * 10n }).trade!;
    expect(ten.shares).toBe(one.shares * 10n + 8n); // Conversion floors once, after applying the multiplier.
    expect(Number(ten.pricePerShare) / Number(one.pricePerShare)).toBeCloseTo(0.1, 12);
    expect(
      classifyTrade(
        { ...input, changedTokenInfo: [...input.changedTokenInfo, input.changedTokenInfo[1]!] },
        token,
      ).trade,
    ).toBeNull();
    expect(fixed("1.25e-4")).toBe(125000000000000n);
  });
});
describe("labels and aggregates", () => {
  it("labels the fixture's top NVDAB trader as bot and top NVDAB holder as custody", () => {
    expect(labelWallet(traders[0]!).bot).toBe(true);
    expect(labelWallet(holders[0]!).custody).toBe(true);
    expect(labelWallet({ ...traders[0]!, avgBuyPrice: "0", avgSellPrice: "0" }).bot).toBe(false);
    expect(labelWallet({ ...holders[0]!, holdingPercent: "19.999" }).custody).toBe(false);
    expect(labelWallet({ ...holders[0]!, fundingSourceLabel: null }).custody).toBe(false);
    expect(
      labelWallet(
        { ...holders[0]!, fundingSourceLabel: null },
        { custody: [holders[0]!.holderWalletAddress.toUpperCase()] },
      ).custody,
    ).toBe(true);
  });
  it("null holdingPercent from the 2026-10-04 EC2 top-trader shape leaves bot detection independent and custody unknown", () => {
    const topTrader = { ...traders[0]!, holdingPercent: null };
    expect(labelWallet(topTrader).bot).toBe(true);
    const cex = { ...holders[0]!, holdingPercent: null };
    expect(labelWallet(cex).custody).toBe(false);
    expect(labelWallet(cex).reasons).toContain(
      "Holder supply percentage unavailable; custody percentage rule skipped",
    );
    expect(labelWallet(cex, { custody: [cex.holderWalletAddress] }).custody).toBe(true);
  });
  it("a null percentage on the holders endpoint leaves concentration unknown instead of summing a partial set", () => {
    const snapshot = sample({
      holders: [{ ...holders[0]!, holdingPercent: null }, ...holders.slice(1)],
    });
    expect(aggregateFlow(snapshot, now)).toMatchObject({
      top10ConcentrationPercent: null,
      concentrationReason: "Holder supply percentage unavailable; concentration unknown",
    });
    const missing = holders[0]!.holderWalletAddress.toLowerCase();
    const configuredCustody = sample({
      ...snapshot,
      labels: { [missing]: { custody: true, bot: false, reasons: [] } },
    });
    expect(aggregateFlow(configuredCustody, now).top10ConcentrationPercent).toBeNull();
  });
  it("nets bigint shares for every window, removes bots, de-duplicates trades and excludes custody from concentration", () => {
    const trade: FlowTrade = {
      id: "buy",
      txHash: "x",
      wallet: "wallet",
      side: "buy",
      at: now - 1000,
      shares: 10n * E18,
      usd: 10000n * E18,
      pricePerShare: 1000n * E18,
      source: "binance",
      priceReason: null,
    };
    const sell = {
      ...trade,
      id: "sell",
      side: "sell" as const,
      shares: 2n * E18,
      at: now - WINDOWS["1h"] - 1,
    };
    const bot = { ...trade, id: "bot", wallet: traders[0]!.holderWalletAddress };
    const flow = aggregateFlow(
      sample({
        trades: [trade, trade, sell, bot],
        labels: {
          [bot.wallet]: labelWallet(traders[0]!),
          [holders[0]!.holderWalletAddress]: labelWallet(holders[0]!),
        },
      }),
      now,
    );
    expect(flow.windows["1h"].netShares).toBe(10n * E18);
    expect(flow.windows["24h"].netShares).toBe(8n * E18);
    expect(flow.windows["7d"].netShares).toBe(8n * E18);
    expect(flow.windows["24h"].buys).toBe(1);
    expect(flow.whalePrints).toHaveLength(2);
    expect(flow.lastRealTradeAgeMs).toBe(1000);
    const percentages = holders
      .slice(1)
      .map((h) => fixed(h.holdingPercent!)) // This immutable holder fixture contains known percentages.
      .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
      .slice(0, 10);
    expect(flow.top10ConcentrationPercent).toBe(percentages.reduce((s, h) => s + h, 0n));
  });
  it("incomplete history and missing prices do not fabricate cleaned volume; ghost checks skip stale data", () => {
    expect(
      aggregateFlow(sample({ coverageStartMs: null }), now).windows["24h"].realVolumeUsd,
    ).toBeNull();
    const ghost = checkGhost({
      realVolume24hUsd: 999n * E18,
      lastRealTradeAgeMs: null,
      reason: null,
    });
    expect(ghost.ghost).toBe(true);
    expect(
      checkGhost({ realVolume24hUsd: 1000n * E18, lastRealTradeAgeMs: 0, reason: null }).ghost,
    ).toBe(false);
    expect(
      checkGhost({
        realVolume24hUsd: 2000n * E18,
        lastRealTradeAgeMs: 4 * WINDOWS["24h"],
        reason: null,
      }).ghost,
    ).toBe(true);
    expect(
      checkGhost({ realVolume24hUsd: null, lastRealTradeAgeMs: null, reason: "No receipt" })
        .outcome,
    ).toBe("skipped");
    expect(
      checkGhost({ realVolume24hUsd: 0n, lastRealTradeAgeMs: null, reason: null, stale: true })
        .outcome,
    ).toBe("skipped");
  });
});
describe("recorded chain fallback", () => {
  it("a recorded pool-to-wallet Transfer is a buy with shares and no invented USD price", async () => {
    const engine = createFixtureEngine();
    const recording = readFlowRecording();
    const logs = await engine.chain.transferLogs(
      token.address,
      BigInt(recording._meta.fromBlock),
      BigInt(recording._meta.toBlock),
    );
    const clean = classifyChainLogs(logs, token, pools);
    const buy = clean.trades.find((t) => t.side === "buy");
    expect(buy).toBeDefined();
    expect(buy!.shares).toBeGreaterThan(0n);
    expect(buy!.usd).toBeNull();
    expect(buy!.priceReason).toBe("price unavailable from chain logs");
    const log = logs.find((l) => `${l.transactionHash}:${l.logIndex}` === buy!.id)!;
    expect("0x" + log.topics[1]!.slice(-40)).toBe(buy!.pool);
    expect(
      clean.trades.every((t) => !pools.some((p) => p.poolAddress.toLowerCase() === t.wallet)),
    ).toBe(true);
  });
  it("receipt prices require an unambiguous stablecoin leg in the same transaction and pool", () => {
    const pool = pools[0]!.poolAddress,
      wallet = "0x" + "1".repeat(40),
      hash = "0x" + "2".repeat(64);
    const word = (address: string) => "0x" + address.slice(2).padStart(64, "0");
    const stock = {
      address: token.address,
      topics: [TRANSFER_TOPIC, word(pool), word(wallet)],
      data: "0x" + (100n * E18).toString(16).padStart(64, "0"),
      logIndex: 1,
    };
    const stable = {
      address: "0x55d398326f99059ff775485246999027b3197955",
      topics: [TRANSFER_TOPIC, word(wallet), word(pool)],
      data: "0x" + (20000n * E18).toString(16).padStart(64, "0"),
      logIndex: 2,
    };
    const trade = classifyChainLogs(
      [{ ...stock, transactionHash: hash, blockNumber: 1n, timestampMs: now }],
      token,
      pools,
    ).trades[0]!;
    const receipt = { transactionHash: hash, status: "success" as const, logs: [stock, stable] };
    expect(priceWhaleFromReceipt(trade, receipt, token).usd).toBe(20000n * E18);
    expect(
      priceWhaleFromReceipt(trade, { ...receipt, transactionHash: "wrong" }, token).usd,
    ).toBeNull();
    expect(
      priceWhaleFromReceipt(trade, { ...receipt, logs: [stock, stock, stable] }, token).usd,
    ).toBeNull();
    expect(priceWhaleFromReceipt(trade, { ...receipt, status: "reverted" }, token).usd).toBeNull();
  });
  it("API mocked down uses recorded logs, calls onWarn, caps receipts at 20 per run and tails from the last block", async () => {
    const store = openStore(":memory:");
    try {
      const engine = createFixtureEngine(),
        onWarn = vi.fn();
      engine.collectors.trades = vi.fn(async () => {
        throw new Error("mock API outage");
      });
      const transferLogs = vi.spyOn(engine.chain, "transferLogs"),
        receipts = vi.spyOn(engine.chain, "transactionReceipt");
      store.put({
        kind: "price",
        key: token.address,
        observedAt: now,
        source: "fixture",
        data: { tokenPrice: "234.26", tokenPriceUpdatedAt: now },
      });
      const ctx: WorkerContext = { store, health: store.health, engine, onWarn, now: () => now };
      await collectFlow(ctx, { tokens: [token], fixture: true });
      const snapshot = store.latest<FlowSnapshot>("flow", token.address, {
        maxAgeMs: 900000,
        now,
      })!;
      expect(snapshot.source).toBe("chain-logs");
      expect(snapshot.data.trades.length).toBeGreaterThan(0);
      expect(onWarn).toHaveBeenCalledWith(expect.stringContaining("mock API outage"));
      expect(receipts.mock.calls.length).toBeLessThanOrEqual(20);
      expect(receipts.mock.calls.length).toBeGreaterThan(0);
      await collectFlow(ctx, { tokens: [token], fixture: true });
      expect(transferLogs).toHaveBeenCalledTimes(1);
    } finally {
      store.close();
    }
  });
  it("both sources failing retain the last snapshot and its original observation time", async () => {
    const store = openStore(":memory:");
    try {
      const engine = createFixtureEngine(),
        onWarn = vi.fn();
      const previous = {
        kind: "flow",
        key: token.address,
        observedAt: now - 1000000,
        source: "binance",
        data: sample(),
      };
      store.put(previous);
      engine.collectors.trades = vi.fn(async () => {
        throw new Error("API down");
      });
      engine.chain.blockNumber = vi.fn(async () => {
        throw new Error("RPC down");
      });
      await expect(
        collectFlow(
          { store, health: store.health, engine, onWarn, now: () => now },
          { tokens: [token], fixture: true },
        ),
      ).rejects.toThrow("last snapshots retained");
      expect(store.latest("flow", token.address, { maxAgeMs: 900000, now })).toMatchObject({
        observedAt: previous.observedAt,
        stale: true,
      });
      expect(onWarn).toHaveBeenCalledWith(expect.stringContaining("both sources failed"));
    } finally {
      store.close();
    }
  });
  it("pages cursors and de-duplicates overlap without calling the logs path", async () => {
    const store = openStore(":memory:");
    try {
      const engine = createFixtureEngine(),
        onWarn = vi.fn();
      const input = trades.find((t) => classifyTrade(t, token).trade)!;
      const call = vi
        .fn()
        .mockResolvedValueOnce({ trades: [input], cursor: "next" })
        .mockResolvedValueOnce({ trades: [input], cursor: null });
      engine.collectors.trades = call;
      const logs = vi.spyOn(engine.chain, "transferLogs");
      await collectFlow(
        { store, health: store.health, engine, onWarn, now: () => input.time },
        { tokens: [token], fixture: false },
      );
      expect(call.mock.calls.map((args) => args[1])).toEqual([undefined, "next"]);
      expect(logs).not.toHaveBeenCalled();
      expect(
        store.latest<FlowSnapshot>("flow", token.address, { maxAgeMs: 900000, now: input.time })!
          .data.trades,
      ).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});

it("the injected grade implementation replaces the ghost record without double deduction or old ghost reasons", async () => {
  const { gradeIntegrity } = await import("@tally/core");
  const { extendIntegrity } = await import("./index");
  const base = gradeIntegrity({
    session: "closed",
    status: null,
    now,
    unitTrap: false,
    onchainVolume24hUsd: 0,
  });
  expect(base.flags).toContain("ghost");
  const extended = extendIntegrity(base, {
    realVolume24hUsd: 2000n * E18,
    lastRealTradeAgeMs: 0,
    reason: null,
  });
  expect(extended.score).toBe(base.score + 40);
  expect(extended.flags).not.toContain("ghost");
  expect(extended.reasons.some((r) => r.flag === "ghost")).toBe(false);
  expect(extended.checks.filter((r) => r.id === "onchain-volume")).toHaveLength(1);
  expect(
    extendIntegrity(base, { realVolume24hUsd: 0n, lastRealTradeAgeMs: null, reason: null }).score,
  ).toBe(base.score);
  expect(
    extendIntegrity(base, {
      realVolume24hUsd: null,
      lastRealTradeAgeMs: null,
      reason: "Missing",
      stale: true,
    }).checks,
  ).toEqual(base.checks);
});

it("pool-to-pool, mint/burn, removed logs and intermediate router hops are excluded", () => {
  const pool = pools[0]!.poolAddress,
    other = pools[1]!.poolAddress,
    wallet = "0x" + "3".repeat(40),
    router = "0x" + "4".repeat(40),
    zero = "0x" + "0".repeat(40);
  const word = (a: string) => "0x" + a.slice(2).padStart(64, "0");
  const log = (from: string, to: string, index: number, tx = "same") => ({
    address: token.address,
    topics: [TRANSFER_TOPIC, word(from), word(to)],
    data: "0x" + E18.toString(16).padStart(64, "0"),
    transactionHash: tx,
    blockNumber: 1n,
    logIndex: index,
    timestampMs: now,
  });
  const input = [
    log(pool, other, 0, "pool"),
    log(zero, pool, 1, "mint"),
    log(pool, zero, 2, "burn"),
    log(pool, router, 3),
    log(router, wallet, 4),
    { ...log(pool, wallet, 5, "removed"), removed: true },
  ];
  expect(classifyChainLogs(input, token, pools).trades).toHaveLength(0);
  expect(classifyChainLogs([log(pool, wallet, 6, "buy")], token, pools).trades[0]!.side).toBe(
    "buy",
  );
  expect(classifyChainLogs([log(wallet, pool, 7, "sell")], token, pools).trades[0]!.side).toBe(
    "sell",
  );
});

it("the captured whale receipts keep ambiguous stablecoin evidence unpriced", async () => {
  const engine = createFixtureEngine(),
    recording = readFlowRecording();
  const logs = await engine.chain.transferLogs(
    token.address,
    BigInt(recording._meta.fromBlock),
    BigInt(recording._meta.toBlock),
  );
  const clean = classifyChainLogs(logs, token, pools);
  const captured = clean.trades.filter((t) => recording.tokens.NVDAB!.receipts[t.txHash]);
  expect(captured.length).toBeGreaterThan(0);
  for (const trade of captured) {
    const receipt = await engine.chain.transactionReceipt(trade.txHash);
    expect(priceWhaleFromReceipt(trade, receipt, token).usd).toBeNull();
  }
});

it("high-volume seven-day tapes do not exceed the JavaScript argument limit", () => {
  const trades: FlowTrade[] = Array.from({ length: 150000 }, (_, index) => ({
    id: String(index),
    txHash: String(index),
    wallet: "wallet",
    side: "buy",
    at: now - index,
    shares: 1n,
    usd: 1n,
    pricePerShare: 1n,
    priceReason: null,
    source: "binance",
  }));
  const aggregate = aggregateFlow(sample({ trades }), now);
  expect(aggregate.lastRealTradeAgeMs).toBe(0);
  expect(aggregate.windows["7d"].buys).toBe(150000);
  expect(aggregate.windows["7d"].netShares).toBe(150000n);
});

it("replacing volume preserves all other penalties even when the original grade was clamped at zero", async () => {
  const { gradeIntegrity } = await import("@tally/core");
  const { extendIntegrity } = await import("./index");
  const base = gradeIntegrity({
    session: "regular",
    premium: 0.05,
    status: { kind: "paused", reasonCode: "pause", reasonMsg: null, session: "regular" },
    now,
    unitTrap: false,
    onchainVolume24hUsd: 0,
  });
  expect(base.score).toBe(0);
  const input = { realVolume24hUsd: 2000n * E18, lastRealTradeAgeMs: 0, reason: null };
  expect(extendIntegrity(base, input).score).toBe(20);
});

describe("bounded flow collection", () => {
  it("null top-trader percentages do not trigger metadata fallback or invalidate complete trade coverage", async () => {
    const store = openStore(":memory:");
    try {
      const engine = createFixtureEngine();
      const recorded = await engine.collectors.topTraders(token.address);
      engine.collectors.topTraders = vi.fn(async () =>
        recorded.map((row) => ({ ...row, holdingPercent: null })),
      );
      engine.collectors.trades = vi.fn(async () => ({ trades: [], cursor: null }));
      const onWarn = vi.fn(),
        logs = vi.spyOn(engine.chain, "blockNumber");
      await collectFlow(
        { store, health: store.health, engine, onWarn, now: () => now },
        { tokens: [token], fixture: false },
      );
      const snapshot = store.latest<FlowSnapshot>("flow", token.address, {
        maxAgeMs: 900000,
        now,
      })!;
      expect(snapshot.source).toBe("binance");
      expect(snapshot.data.cleaningReason).toBeNull();
      expect(snapshot.data.coverageStartMs).toBe(now - WINDOWS["7d"]);
      expect(snapshot.data.labels[recorded[0]!.holderWalletAddress.toLowerCase()]!.bot).toBe(true);
      expect(aggregateFlow(snapshot.data, now).windows["24h"]).toMatchObject({
        realVolumeUsd: 0n,
        reason: null,
      });
      expect(logs).not.toHaveBeenCalled();
      expect(onWarn).not.toHaveBeenCalled();
    } finally {
      store.close();
    }
  });
  it("a fake-clock budget stops the run and the next run services the untouched tokens first", async () => {
    const store = openStore(":memory:");
    try {
      const engine = createFixtureEngine();
      let clock = now;
      const tokens = [1, 2, 3].map((n) => ({ ...token, address: "0x" + String(n).repeat(40) }));
      for (const t of tokens)
        for (const kind of ["flow-holders", "flow-traders", "flow-pools"])
          store.put({ kind, key: t.address, observedAt: clock, source: "binance", data: [] });
      const read = vi.fn(async (_key: string, _cursor?: string, _limit?: number) => {
        clock += 30_000;
        return { trades: [], cursor: null };
      });
      engine.collectors.trades = read;
      const ctx = { store, health: store.health, engine, now: () => clock, onWarn: vi.fn() };
      await collectFlow(ctx, { tokens, fixture: false });
      expect(read.mock.calls).toHaveLength(2);
      expect(store.latest("flow", tokens[2]!.address, { maxAgeMs: 900000, now: clock })).toBeNull();
      expect(
        store.latest("flow-collection", "bsc", { maxAgeMs: 900000, now: clock })!.data,
      ).toMatchObject({
        attempted: 2,
        deferred: 1,
        elapsedMs: 60_000,
      });
      clock += 60_000;
      await collectFlow(ctx, { tokens, fixture: false });
      expect(read.mock.calls.map((args) => args[0])).toEqual([
        tokens[0]!.address,
        tokens[1]!.address,
        tokens[2]!.address,
        tokens[0]!.address,
      ]);
    } finally {
      store.close();
    }
  });

  it("uses one-page tails after the initial backfill and resumes a saved cursor one page at a time", async () => {
    const store = openStore(":memory:");
    try {
      const engine = createFixtureEngine();
      const input = (await engine.collectors.trades(token.address)).trades.find(
        (t) => classifyTrade(t, token).trade,
      )!;
      const read = vi.fn(async (_key: string, cursor?: string, _limit?: number) => ({
        trades: [input],
        cursor: cursor === "end" ? null : cursor ? "end" : "history",
      }));
      engine.collectors.trades = read;
      const ctx = { store, health: store.health, engine, now: () => input.time, onWarn: vi.fn() };
      await collectFlow(ctx, { tokens: [token], fixture: false, maxPages: 1 });
      expect(read.mock.calls.map((a) => a[1])).toEqual([undefined]);
      await collectFlow(ctx, { tokens: [token], fixture: false });
      expect(read.mock.calls.slice(1).map((a) => a[1])).toEqual([undefined, "history"]);
      await collectFlow(ctx, { tokens: [token], fixture: false });
      expect(read.mock.calls.slice(3).map((a) => a[1])).toEqual([undefined, "end"]);
      await collectFlow(ctx, { tokens: [token], fixture: false });
      expect(read.mock.calls.slice(5).map((a) => a[1])).toEqual([undefined]);
      expect(read.mock.calls.every((a) => a[2] === 100)).toBe(true);
    } finally {
      store.close();
    }
  });

  it("reuses discovery and fresh Radar facts and refreshes only an expired ticker", async () => {
    const store = openStore(":memory:");
    try {
      const engine = createFixtureEngine();
      const baseRows = await engine.facts("NVDA");
      let clock = now;
      const facts = vi.fn(async (ticker: string) =>
        baseRows
          .map((r) => ({
            ...r,
            facts: { ...r.facts, onchainVolume24hUsd: 2000 },
            symbol: ticker,
            address: ("0x" + (ticker === "AAA" ? "1" : "2").repeat(40)) as `0x${string}`,
          }))
          .slice(0, 1),
      );
      engine.facts = facts;
      engine.collectors.trades = vi.fn(async () => ({ trades: [], cursor: null }));
      engine.collectors.holders = vi.fn(async () => []);
      engine.collectors.topTraders = vi.fn(async () => []);
      engine.collectors.topLiquidity = vi.fn(async () => []);
      store.put({
        kind: "registry",
        key: "bsc",
        source: "binance",
        observedAt: clock,
        data: [{ underlyingTicker: "AAA" }, { underlyingTicker: "BBB" }],
      });
      const ctx = { store, health: store.health, engine, now: () => clock, onWarn: vi.fn() };
      await collectFlow(ctx, { fixture: false });
      expect(facts.mock.calls.map((a) => a[0])).toEqual(["AAA", "BBB"]);
      const registryTime = store.latest("flow-registry", "bsc", {
        maxAgeMs: 900000,
        now: clock,
      })!.observedAt;
      clock += 60_000;
      await collectFlow(ctx, { fixture: false });
      expect(facts).toHaveBeenCalledTimes(2);
      expect(engine.collectors.holders).toHaveBeenCalledTimes(2);
      expect(
        store.latest("flow-registry", "bsc", { maxAgeMs: 900000, now: clock })!.observedAt,
      ).toBe(registryTime);
      clock += 600_000;
      const address = "0x" + "2".repeat(40);
      const radar = store.latest("radar", address, { maxAgeMs: 900000, now: clock })!;
      store.put({
        kind: "radar",
        key: address,
        source: radar.source,
        observedAt: clock,
        data: radar.data,
      });
      await collectFlow(ctx, { fixture: false });
      expect(facts.mock.calls.map((a) => a[0])).toEqual(["AAA", "BBB", "AAA"]);
    } finally {
      store.close();
    }
  });

  it("missing top-trader labels carry a cleaning reason without falsifying history coverage", async () => {
    const store = openStore(":memory:");
    try {
      const engine = createFixtureEngine();
      engine.collectors.trades = vi.fn(async () => ({ trades: [], cursor: null }));
      engine.collectors.topTraders = vi.fn(async () => {
        throw new Error("labels offline");
      });
      await collectFlow(
        { store, health: store.health, engine, now: () => now, onWarn: vi.fn() },
        { tokens: [token], fixture: false },
      );
      const snapshot = store.latest<FlowSnapshot>("flow", token.address, {
        maxAgeMs: 900000,
        now,
      })!.data;
      expect(snapshot.coverageStartMs).toBe(now - WINDOWS["7d"]);
      for (const window of Object.values(aggregateFlow(snapshot, now).windows)) {
        expect(window.realVolumeUsd).toBeNull();
        expect(window.reason).toBe("Top-trader labels unavailable; volume not cleaned");
      }
    } finally {
      store.close();
    }
  });
});

it("active flow ranks by volume under a hard cap and always reserves slots for resolved wallet holdings", () => {
  const candidates = Array.from({ length: 65 }, (_, i) => ({
    token: { ...token, address: "0x" + (i + 1).toString(16).padStart(40, "0") },
    rawVolume24hUsd: BigInt(i + 1000) * E18,
    held: false,
  }));
  candidates[0]!.held = true;
  candidates[0]!.rawVolume24hUsd = 1n;
  const result = selectActiveFlow(candidates);
  expect(result.active).toHaveLength(60);
  expect(result.active[0]!.address).toBe(candidates[0]!.token.address);
  expect(result.active[1]!.address).toBe(candidates[64]!.token.address);
  expect(result.statuses[candidates[1]!.token.address]!.reason).toContain("outside top 60");
  const unresolved = { ...candidates[0]!, token: { ...candidates[0]!.token, multiplier: 0n } };
  expect(selectActiveFlow([unresolved]).statuses[unresolved.token.address]!.reason).toBe(
    "share multiplier unavailable",
  );
  expect(() => selectActiveFlow(candidates.map((c) => ({ ...c, held: true })))).toThrow(
    "capacity exceeded",
  );
});

it("a raw-ghost token is skipped by collectors but keeps its Radar grade, reason and 30-minute facts cache", async () => {
  const store = openStore(":memory:");
  try {
    const engine = createFixtureEngine();
    const row = (await engine.facts("NVDA"))[0]!;
    let clock = now;
    engine.facts = vi.fn(async () => [
      { ...row, facts: { ...row.facts, onchainVolume24hUsd: 999 } },
    ]);
    const tails = vi.spyOn(engine.collectors, "trades"),
      holdersRead = vi.spyOn(engine.collectors, "holders"),
      labelsRead = vi.spyOn(engine.collectors, "topTraders"),
      poolsRead = vi.spyOn(engine.collectors, "topLiquidity");
    store.put({
      kind: "registry",
      key: "bsc",
      source: "binance",
      observedAt: clock,
      data: [{ underlyingTicker: "NVDA" }],
    });
    const ctx = { store, health: store.health, engine, onWarn: vi.fn(), now: () => clock };
    await collectFlow(ctx, { fixture: false });
    expect(tails).not.toHaveBeenCalled();
    expect(holdersRead).not.toHaveBeenCalled();
    expect(labelsRead).not.toHaveBeenCalled();
    expect(poolsRead).not.toHaveBeenCalled();
    const radar = store.latest("radar", row.address.toLowerCase(), {
      maxAgeMs: 3600000,
      now: clock,
    })!;
    expect(radar.data).toMatchObject({
      grade: row.integrity.grade,
      integrity: row.integrity,
      rawVolume24hUsd: 999n * E18,
      flowActive: false,
      flowReason: "no real market: under $1,000 24h",
    });
    expect(
      store.latest<FlowToken[]>("radar-registry", "bsc", { maxAgeMs: 3600000, now: clock })!.data,
    ).toHaveLength(1);
    clock += 20 * 60000;
    await collectFlow(ctx, { fixture: false });
    expect(engine.facts).toHaveBeenCalledTimes(1);
    expect(
      store.latest("radar", row.address.toLowerCase(), { maxAgeMs: 3600000, now: clock })!.ageMs,
    ).toBe(20 * 60000);
    clock += 11 * 60000;
    await collectFlow(ctx, { fixture: false });
    expect(engine.facts).toHaveBeenCalledTimes(2);
    expect(tails).not.toHaveBeenCalled();
  } finally {
    store.close();
  }
});

it("a registered wallet's portfolio includes its held raw-ghost token without a new wallet API call", async () => {
  const store = openStore(":memory:");
  try {
    const engine = createFixtureEngine();
    const row = (await engine.facts("NVDA"))[0]!;
    engine.facts = vi.fn(async () => [
      { ...row, facts: { ...row.facts, onchainVolume24hUsd: 10 } },
    ]);
    engine.collectors.trades = vi.fn(async () => ({ trades: [], cursor: null }));
    engine.collectors.holders = vi.fn(async () => []);
    engine.collectors.topTraders = vi.fn(async () => []);
    engine.collectors.topLiquidity = vi.fn(async () => []);
    const wallet = "0x" + "a".repeat(40);
    store.put({
      kind: "wallet:active",
      key: "bsc",
      source: "session",
      observedAt: now,
      data: { address: wallet },
    });
    store.put({
      kind: "portfolio",
      key: wallet,
      source: "binance",
      observedAt: now,
      data: {
        holdings: [
          {
            tokenContractAddress: row.address,
            ticker: "NVDA",
            balanceTokens: E18,
            isRecognized: true,
          },
        ],
      },
    });
    store.put({ kind: "registry", key: "bsc", source: "binance", observedAt: now, data: [] });
    await collectFlow(
      { store, health: store.health, engine, onWarn: vi.fn(), now: () => now },
      { fixture: false },
    );
    expect(engine.collectors.trades).toHaveBeenCalledWith(
      row.address.toLowerCase(),
      undefined,
      100,
    );
    expect(
      store.latest("radar", row.address.toLowerCase(), { maxAgeMs: 3600000, now })!.data,
    ).toMatchObject({ flowActive: true, flowReason: null });
  } finally {
    store.close();
  }
});

it("a full 60-token pass finishes under ten minutes at 4 req/s with resumable cold metadata", async () => {
  const store = openStore(":memory:");
  try {
    const engine = createFixtureEngine();
    let clock = now;
    const tokens = Array.from({ length: 60 }, (_, i) => ({
      ...token,
      address: "0x" + (i + 1).toString(16).padStart(40, "0"),
    }));
    engine.collectors.holders = vi.fn(async () => {
      clock += 250;
      return [];
    });
    engine.collectors.topTraders = vi.fn(async () => {
      clock += 250;
      return [];
    });
    engine.collectors.topLiquidity = vi.fn(async () => {
      clock += 250;
      return [];
    });
    engine.collectors.trades = vi.fn(async () => {
      clock += 250;
      return { trades: [], cursor: null };
    });
    const ctx = { store, health: store.health, engine, onWarn: vi.fn(), now: () => clock };
    await collectFlow(ctx, { tokens, fixture: false });
    expect(
      store.latest("flow-collection", "bsc", { maxAgeMs: 900000, now: clock })!.data,
    ).toMatchObject({
      elapsedMs: 45000,
      updated: expect.any(Array),
      deferred: 15,
    });
    clock += 60000; // The existing runner waits after completion.
    await collectFlow(ctx, { tokens, fixture: false });
    expect(
      store.latest("flow-collection", "bsc", { maxAgeMs: 900000, now: clock })!.data,
    ).toMatchObject({
      pass: {
        complete: true,
        tokenCount: 60,
        elapsedMs: 131250,
        marketRequests: 285,
        factsCalls: 0,
      },
    });
    for (const t of tokens)
      expect(store.latest("flow", t.address, { maxAgeMs: 900000, now: clock })!.stale).toBe(false);
  } finally {
    store.close();
  }
});

it("an API outage that exhausts the run budget defers chain reads and retains the snapshot", async () => {
  const store = openStore(":memory:");
  try {
    const engine = createFixtureEngine();
    let clock = now;
    for (const kind of ["flow-holders", "flow-traders", "flow-pools"])
      store.put({ kind, key: token.address, observedAt: clock, source: "binance", data: [] });
    engine.collectors.trades = vi.fn(async () => {
      clock += 45000;
      throw new Error("API offline");
    });
    const rpc = vi.spyOn(engine.chain, "blockNumber");
    store.put({
      kind: "flow",
      key: token.address,
      observedAt: now - 1000,
      source: "binance",
      data: sample(),
    });
    await collectFlow(
      { store, health: store.health, engine, now: () => clock, onWarn: vi.fn() },
      { tokens: [token], fixture: false },
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(store.latest("flow", token.address, { maxAgeMs: 900000, now: clock })!.observedAt).toBe(
      now - 1000,
    );
  } finally {
    store.close();
  }
});

it("an inactive issuer keeps its 30-minute grade age when an active sibling refreshes", async () => {
  const store = openStore(":memory:");
  try {
    const engine = createFixtureEngine();
    const rows = (await engine.facts("NVDA")).filter((r) => r.multiplier).slice(0, 2);
    expect(rows).toHaveLength(2);
    let clock = now;
    engine.facts = vi.fn(async () =>
      rows.map((r, i) => ({
        ...r,
        facts: { ...r.facts, onchainVolume24hUsd: i === 0 ? 2000 : 10 },
      })),
    );
    engine.collectors.trades = vi.fn(async () => ({ trades: [], cursor: null }));
    engine.collectors.holders = vi.fn(async () => []);
    engine.collectors.topTraders = vi.fn(async () => []);
    engine.collectors.topLiquidity = vi.fn(async () => []);
    store.put({
      kind: "registry",
      key: "bsc",
      source: "binance",
      observedAt: clock,
      data: [{ underlyingTicker: "NVDA" }],
    });
    const ctx = { store, health: store.health, engine, onWarn: vi.fn(), now: () => clock };
    await collectFlow(ctx, { fixture: false });
    clock += 11 * 60000;
    await collectFlow(ctx, { fixture: false });
    expect(engine.facts).toHaveBeenCalledTimes(2);
    expect(
      store.latest("radar", rows[1]!.address.toLowerCase(), { maxAgeMs: 3600000, now: clock })!
        .ageMs,
    ).toBe(11 * 60000);
    clock += 60000;
    await collectFlow(ctx, { fixture: false });
    expect(engine.facts).toHaveBeenCalledTimes(2);
  } finally {
    store.close();
  }
});

it("discovery with no successful facts reports failure instead of claiming a healthy empty active set", async () => {
  const store = openStore(":memory:");
  try {
    const engine = createFixtureEngine();
    engine.facts = vi.fn(async () => {
      throw new Error("facts source offline");
    });
    const onWarn = vi.fn();
    store.put({
      kind: "registry",
      key: "bsc",
      source: "binance",
      observedAt: now,
      data: [{ underlyingTicker: "NVDA" }],
    });
    await expect(
      collectFlow(
        { store, health: store.health, engine, onWarn, now: () => now },
        { fixture: false },
      ),
    ).rejects.toThrow("no grade observations");
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining("facts source offline"));
  } finally {
    store.close();
  }
});
