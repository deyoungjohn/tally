import { readFileSync, readdirSync } from "node:fs";
import { E18 } from "@tally/core";
import { openStore, type OpenSnapshotStore } from "@tally/modkit";
import { afterEach, expect, it, vi } from "vitest";
import { collectAutopilotPositions, job } from "../../../apps/worker/src/jobs/autopilot";
import { runJobs } from "../../../apps/worker/src/runner";
import { collectorContext, registryRow, seedRegistry } from "./collector-fixtures";
import {
  constructedAlert,
  constructedPolicy,
  constructedPosition,
  constructedRow,
  CONSTRUCTED_NOW as now,
  CONSTRUCTED_WALLET as wallet,
  CONSTRUCTED_TOKEN as token,
} from "./fixtures";
import { appendDecisionRows, readDecisionLog } from "./log";
import { positionKey, runShadow } from "./shadow";
import type { Position } from "./types";

const stores: OpenSnapshotStore[] = [];
function setup() {
  const store = openStore(":memory:");
  stores.push(store);
  seedRegistry(store);
  store.put({
    kind: "autopilot-policy",
    key: wallet,
    data: constructedPolicy(),
    source: "constructed",
    observedAt: now,
  });
  store.put({
    kind: "alerts",
    key: wallet,
    data: [constructedAlert()],
    source: "constructed",
    observedAt: now,
  });
  return { store, ctx: collectorContext(store) };
}
const position = (store: OpenSnapshotStore) =>
  store.latest<Position>("autopilot-position", positionKey(wallet, token), {
    maxAgeMs: 60_000,
    now,
  })!.data;
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it.each(["ondo", "bstock"] as const)(
  "collector uses chain balance and accepted %s multiplier, with correct E18 shares and USD",
  async (issuer) => {
    const { store, ctx } = setup();
    const multiplier = issuer === "ondo" ? 10n * E18 : E18;
    store.put({
      kind: "registry",
      key: "bsc",
      data: [
        { ...registryRow, platformId: issuer, tokenToShareRatio: issuer === "ondo" ? "10" : "1" },
      ],
      source: "constructed",
      observedAt: now,
    });
    vi.spyOn(ctx.engine, "sharesOf").mockResolvedValue({
      address: wallet,
      asOf: new Date(now).toISOString(),
      tickers: ["NFLX"],
      rows: [
        {
          address: token,
          ticker: "NFLX",
          symbol: "NFLX",
          issuer,
          decimals: 18,
          balance: 2n * E18,
          shares: 999n * E18,
          multiplier,
          source: "api",
          degraded: false,
          reason: null,
        },
      ],
      groups: [],
      failed: [],
      warnings: [],
    });
    // API-derived portfolio/display balances must never affect sizing.
    store.put({
      kind: "portfolio",
      key: wallet,
      data: { holdings: [{ balanceTokens: 999999n * E18 }] },
      source: "display",
      observedAt: now,
    });
    await collectAutopilotPositions(ctx);
    expect(position(store)).toMatchObject({
      chainBalanceTokens: 2n * E18,
      balanceSource: "chain",
      tokenDecimals: 18,
      multiplier,
      shares: issuer === "ondo" ? 20n * E18 : 2n * E18,
      usdPerShare: issuer === "ondo" ? 10n * E18 : 100n * E18,
      grade: "D",
    });
    expect(ctx.engine.sharesOf).toHaveBeenCalledWith(wallet, ["NFLX"]);
  },
);
it("unknown accepted multiplier remains null and refuses downstream", async () => {
  const { store, ctx } = setup();
  const report = await ctx.engine.sharesOf(wallet);
  report.rows[0]!.multiplier = null;
  vi.spyOn(ctx.engine, "sharesOf").mockResolvedValue(report);
  await collectAutopilotPositions(ctx);
  expect(position(store)).toMatchObject({ multiplier: null, shares: null });
  runShadow(ctx);
  expect(readDecisionLog(store)[0]?.reasons).toContain("unknown multiplier");
  expect(ctx.onWarn).toHaveBeenCalledWith(expect.stringContaining("unknown multiplier"));
});
it.each([6, null, undefined])(
  "registry decimals %s are unknown, warned and refused",
  async (decimals) => {
    const { store, ctx } = setup();
    const report = await ctx.engine.sharesOf(wallet);
    report.rows[0]!.decimals = decimals as number;
    vi.spyOn(ctx.engine, "sharesOf").mockResolvedValue(report);
    await collectAutopilotPositions(ctx);
    expect(position(store)).toMatchObject({ tokenDecimals: null, shares: null });
    runShadow(ctx);
    expect(readDecisionLog(store)[0]?.reasons).toContain("unknown token decimals");
    expect(ctx.onWarn).toHaveBeenCalledWith("Autopilot: unknown token decimals");
  },
);
it("continuous pause starts once, survives repeated/unknown readings, clears on unpause and restarts", async () => {
  const { store, ctx } = setup();
  let current = now;
  ctx.now = () => current;
  const read = vi
    .spyOn(ctx.engine, "pauseState")
    .mockResolvedValue({ paused: true, reason: null, observedAt: now });
  await collectAutopilotPositions(ctx);
  expect(position(store).pausedSince).toBe(now);
  current++;
  await collectAutopilotPositions(ctx);
  expect(position(store).pausedSince).toBe(now);
  read.mockResolvedValue({ paused: null, reason: "unavailable", observedAt: current });
  current++;
  await collectAutopilotPositions(ctx);
  expect(position(store)).toMatchObject({ paused: null, pausedSince: now });
  read.mockResolvedValue({ paused: false, reason: null, observedAt: current });
  current++;
  await collectAutopilotPositions(ctx);
  expect(position(store)).toMatchObject({ paused: false, pausedSince: null });
  read.mockResolvedValue({ paused: true, reason: null, observedAt: current });
  current++;
  await collectAutopilotPositions(ctx);
  expect(position(store).pausedSince).toBe(current);
  expect(store.history("autopilot-pause", token, 0)).toHaveLength(3);
});
it("only policy wallets are collected; empty opt-in runs are distinguished from never collected", async () => {
  const store = openStore(":memory:");
  stores.push(store);
  seedRegistry(store);
  store.put({
    kind: "wallet:active",
    key: "bsc",
    data: { address: wallet },
    source: "constructed",
    observedAt: now,
  });
  const ctx = collectorContext(store);
  await collectAutopilotPositions(ctx);
  expect(ctx.engine.sharesOf).not.toHaveBeenCalled();
  store.put({
    kind: "autopilot-policy",
    key: wallet,
    data: constructedPolicy({ tokenAllowList: [] }),
    source: "constructed",
    observedAt: now,
  });
  store.put({
    kind: "alerts",
    key: wallet,
    data: [constructedAlert()],
    source: "constructed",
    observedAt: now,
  });
  await collectAutopilotPositions(ctx);
  expect(store.latest("autopilot-collector", wallet, { maxAgeMs: 60_000, now })?.data).toEqual({
    positionKeys: [],
  });
});
it("quiet and already-decided wallets do no engine work or refresh last good collection", async () => {
  vi.stubEnv("FEATURE_AUTOPILOT", "1");
  const { store, ctx } = setup();
  await job.run(ctx);
  expect(readDecisionLog(store)).toHaveLength(1);
  const before = store.history("autopilot-position", positionKey(wallet, token), 0);
  vi.mocked(ctx.engine.sharesOf).mockClear();
  vi.mocked(ctx.engine.facts).mockClear();
  vi.mocked(ctx.engine.pauseState).mockClear();
  ctx.now = () => now + 60_000;
  await job.run(ctx);
  // No alerts is also a quiet wallet, even with a current stored policy.
  store.put({ kind: "alerts", key: wallet, data: [], source: "constructed", observedAt: now });
  await job.run(ctx);
  expect(ctx.engine.sharesOf).not.toHaveBeenCalled();
  expect(ctx.engine.facts).not.toHaveBeenCalled();
  expect(ctx.engine.pauseState).not.toHaveBeenCalled();
  expect(store.history("autopilot-position", positionKey(wallet, token), 0)).toEqual(before);
  expect(store.history("autopilot-collector", wallet, 0)).toHaveLength(1);
  expect(readDecisionLog(store)).toHaveLength(1);
});
it("ticker facts are shared across wallets and tokens per run, balances stay wallet-specific, and caches refresh next run", async () => {
  const { store, ctx } = setup();
  const otherWallet = `0x${"5".repeat(40)}`;
  const otherToken = `0x${"6".repeat(40)}` as `0x${string}`;
  store.put({
    kind: "registry",
    key: "bsc",
    data: [
      registryRow,
      {
        ...registryRow,
        tokenContractAddress: otherToken,
        platformId: "bstock",
        tokenToShareRatio: "1",
      },
    ],
    source: "constructed",
    observedAt: now,
  });
  for (const address of [wallet, otherWallet]) {
    store.put({
      kind: "autopilot-policy",
      key: address,
      data: constructedPolicy({ tokenAllowList: [token, otherToken] }),
      source: "constructed",
      observedAt: now,
    });
    store.put({
      kind: "alerts",
      key: address,
      data: [constructedAlert({ id: `alert-${address}`, walletAddress: address })],
      source: "constructed",
      observedAt: now,
    });
  }
  const report = await ctx.engine.sharesOf(wallet);
  const facts = await ctx.engine.facts("NFLX");
  const read = vi
    .spyOn(ctx.engine, "sharesOf")
    .mockImplementation(async (address) => ({
      ...report,
      address,
      rows: [
        { ...report.rows[0]!, balance: address === wallet ? E18 : 2n * E18 },
        {
          ...report.rows[0]!,
          address: otherToken,
          issuer: "bstock",
          multiplier: E18,
          balance: address === wallet ? 3n * E18 : 4n * E18,
        },
      ],
    }))
    .mockClear();
  const factRead = vi
    .spyOn(ctx.engine, "facts")
    .mockResolvedValue([
      facts[0]!,
      { ...facts[0]!, address: otherToken, integrity: { ...facts[0]!.integrity, grade: "F" } },
    ])
    .mockClear();
  await collectAutopilotPositions(ctx);
  expect(factRead).toHaveBeenCalledTimes(1);
  expect(factRead).toHaveBeenCalledWith("NFLX");
  expect(read).toHaveBeenCalledTimes(2);
  for (const [address, expectedShares] of [
    [wallet, 10n * E18],
    [otherWallet, 20n * E18],
  ] as const)
    expect(
      store.latest<Position>("autopilot-position", positionKey(address, token), {
        maxAgeMs: 60_000,
        now,
      })?.data.shares,
    ).toBe(expectedShares);
  for (const [address, expectedShares] of [
    [wallet, 3n * E18],
    [otherWallet, 4n * E18],
  ] as const)
    expect(
      store.latest<Position>("autopilot-position", positionKey(address, otherToken), {
        maxAgeMs: 60_000,
        now,
      })?.data,
    ).toMatchObject({ shares: expectedShares, grade: "F" });
  factRead.mockRejectedValue(new Error("unavailable"));
  await collectAutopilotPositions(ctx);
  expect(factRead).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenCalledTimes(4);
  expect(
    store
      .listLatest<Position>("autopilot-position", { maxAgeMs: 60_000, now })
      .every((p) => p.data.grade === null),
  ).toBe(true);
  expect(ctx.onWarn).toHaveBeenCalledWith("Autopilot: grade unknown; engine facts unavailable");
  factRead.mockResolvedValue(facts);
  await collectAutopilotPositions(ctx);
  expect(factRead).toHaveBeenCalledTimes(3);
  expect(position(store).grade).toBe("D");
});
it("20 wallets and 10 tokens per wallet bound work and emit truncation warnings", async () => {
  const { store, ctx } = setup();
  const addresses = Array.from(
    { length: 11 },
    (_, i) => `0x${(i + 100).toString(16).padStart(40, "0")}`,
  );
  store.put({
    kind: "registry",
    key: "bsc",
    data: addresses.map((a) => ({ ...registryRow, tokenContractAddress: a })),
    source: "constructed",
    observedAt: now,
  });
  // This quiet policy must not consume a wallet slot ahead of wallets with pending alerts.
  store.put({ kind: "alerts", key: wallet, data: [], source: "constructed", observedAt: now });
  for (let i = 0; i < 21; i++) {
    const address = `0x${(i + 1000).toString(16).padStart(40, "0")}`;
    store.put({
      kind: "autopilot-policy",
      key: address,
      data: constructedPolicy({ tokenAllowList: addresses }),
      source: "constructed",
      observedAt: now,
    });
    store.put({
      kind: "alerts",
      key: address,
      data: [constructedAlert({ id: `alert-${i}`, walletAddress: address })],
      source: "constructed",
      observedAt: now,
    });
  }
  const report = await ctx.engine.sharesOf(wallet);
  report.rows = addresses.map((a) => ({ ...report.rows[0]!, address: a as `0x${string}` }));
  const read = vi.spyOn(ctx.engine, "sharesOf").mockResolvedValue(report).mockClear();
  await collectAutopilotPositions(ctx);
  expect(read).toHaveBeenCalledTimes(20);
  expect(ctx.engine.facts).toHaveBeenCalledTimes(1);
  expect(ctx.engine.facts).toHaveBeenCalledWith("NFLX");
  expect(
    store.listLatest("autopilot-position", { maxAgeMs: 60_000, now, limit: 1000 }),
  ).toHaveLength(200);
  expect(ctx.onWarn).toHaveBeenCalledWith("Autopilot wallets truncated to 20 per run");
  expect(ctx.onWarn).toHaveBeenCalledWith("Autopilot tokens truncated to 10 per wallet");
});
it("a failed token is warned and skipped while another token is collected", async () => {
  const { store, ctx } = setup();
  const other = `0x${"3".repeat(40)}`;
  store.put({
    kind: "registry",
    key: "bsc",
    data: [registryRow, { ...registryRow, tokenContractAddress: other, underlyingTicker: "AAPL" }],
    source: "constructed",
    observedAt: now,
  });
  store.put({
    kind: "autopilot-policy",
    key: wallet,
    data: constructedPolicy({ tokenAllowList: [other, token] }),
    source: "constructed",
    observedAt: now,
  });
  vi.spyOn(ctx.engine, "sharesOf").mockRejectedValueOnce(new Error("upstream unavailable"));
  await collectAutopilotPositions(ctx);
  expect(position(store).shares).toBe(100n * E18);
  expect(
    store.latest("autopilot-position", positionKey(wallet, other), { maxAgeMs: 60_000, now }),
  ).toBeNull();
  expect(ctx.onWarn).toHaveBeenCalledWith(expect.stringContaining("token skipped"));
});
it("missing reference ratio and unreadable grade/pause remain null with warnings", async () => {
  const { store, ctx } = setup();
  store.put({
    kind: "registry",
    key: "bsc",
    data: [{ ...registryRow, tokenToShareRatio: null }],
    source: "constructed",
    observedAt: now,
  });
  vi.spyOn(ctx.engine, "facts").mockRejectedValue(new Error("upstream"));
  vi.spyOn(ctx.engine, "pauseState").mockRejectedValue(new Error("upstream"));
  await collectAutopilotPositions(ctx);
  expect(position(store)).toMatchObject({
    usdPerShare: null,
    grade: null,
    paused: null,
    pausedSince: null,
  });
  expect(ctx.onWarn).toHaveBeenCalledWith(expect.stringContaining("unknown share price"));
});
it("whole collector failure and already-aborted runs leave last good positions and log intact", async () => {
  vi.stubEnv("FEATURE_AUTOPILOT", "1");
  const { store, ctx } = setup();
  appendDecisionRows(store, [constructedRow()], now - 1);
  store.put({
    kind: "autopilot-position",
    key: positionKey(wallet, token),
    data: constructedPosition(),
    source: "last good",
    observedAt: now,
  });
  vi.spyOn(ctx.engine, "sharesOf").mockRejectedValue(new Error("whole source unavailable"));
  await expect(job.run(ctx)).rejects.toThrow("every token");
  expect(readDecisionLog(store)).toHaveLength(1);
  expect(store.history("autopilot-position", positionKey(wallet, token), 0)).toHaveLength(1);
  const abort = new AbortController();
  abort.abort(new Error("cancelled"));
  await expect(job.run({ ...ctx, signal: abort.signal })).rejects.toThrow("cancelled");
  expect(readDecisionLog(store)).toHaveLength(1);
});
it("30s job timeout cancels a blocked engine read and prevents late collection or log writes", async () => {
  vi.useFakeTimers();
  vi.stubEnv("FEATURE_AUTOPILOT", "1");
  const { store, ctx } = setup();
  appendDecisionRows(store, [constructedRow()], now - 1);
  let resolve!: (value: Awaited<ReturnType<typeof ctx.engine.sharesOf>>) => void;
  const report = await ctx.engine.sharesOf(wallet);
  vi.spyOn(ctx.engine, "sharesOf").mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const stop = new AbortController();
  const running = runJobs([job], { ...ctx, health: store.health }, stop.signal);
  await vi.advanceTimersByTimeAsync(30_001);
  resolve(report);
  await vi.advanceTimersByTimeAsync(1);
  expect(readDecisionLog(store)).toHaveLength(1);
  expect(store.history("autopilot-position", positionKey(wallet, token), 0)).toHaveLength(0);
  expect(store.health.get("autopilot")?.lastError).toBe("timed out after 30000 ms");
  stop.abort();
  await running;
});
it("stored policy -> collected chain position -> eligible shadow row, no execution capabilities", async () => {
  vi.stubEnv("FEATURE_AUTOPILOT", "1");
  const { store, ctx } = setup();
  await job.run(ctx);
  expect(readDecisionLog(store)[0]).toMatchObject({
    decision: "execute",
    mode: "shadow",
    inputs: { spentToday: 0n },
    leg: { tokens: E18 / 4n },
  });
  expect(readDecisionLog(store)[0]?.receiptId).toBeUndefined();
  for (const file of readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".ts"))) {
    const code = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(code).not.toMatch(
      /(?:from\s*["']|import\s*\(["'])(?:[^"']*executor|baw|node:child_process)/,
    );
  }
});

it("unreadable chain balance is null rather than zero, and refuses downstream", async () => {
  const { store, ctx } = setup();
  const report = await ctx.engine.sharesOf(wallet);
  report.rows[0]!.balance = null;
  vi.spyOn(ctx.engine, "sharesOf").mockResolvedValue(report);
  await collectAutopilotPositions(ctx);
  expect(position(store)).toMatchObject({
    chainBalanceTokens: null,
    shares: null,
    balanceSource: "chain",
  });
  runShadow(ctx);
  expect(readDecisionLog(store)[0]?.reasons).toContain("chain balance unavailable");
});
it("fresh price reference takes priority; stale price falls back to recorded registry reference with warning", async () => {
  const { store, ctx } = setup();
  store.put({
    kind: "prices",
    key: "bsc",
    data: [{ tokenContractAddress: token, referencePrice: "200" }],
    source: "constructed",
    observedAt: now,
  });
  await collectAutopilotPositions(ctx);
  expect(position(store).usdPerShare).toBe(20n * E18);
  ctx.now = () => now + 60_001;
  await collectAutopilotPositions(ctx);
  expect(position(store).usdPerShare).toBe(10n * E18);
  expect(ctx.onWarn).toHaveBeenCalledWith(
    "Autopilot: Price snapshot reference unavailable; using registry reference",
  );
});
it("abort after one staged token commits no positions, pause snapshots or decision rows", async () => {
  const { store, ctx } = setup();
  const other = `0x${"4".repeat(40)}`;
  store.put({
    kind: "registry",
    key: "bsc",
    data: [registryRow, { ...registryRow, tokenContractAddress: other, underlyingTicker: "AAPL" }],
    source: "constructed",
    observedAt: now,
  });
  store.put({
    kind: "autopilot-policy",
    key: wallet,
    data: constructedPolicy({ tokenAllowList: [token, other] }),
    source: "constructed",
    observedAt: now,
  });
  appendDecisionRows(store, [constructedRow()], now - 1);
  const report = await ctx.engine.sharesOf(wallet);
  const abort = new AbortController();
  ctx.signal = abort.signal;
  vi.spyOn(ctx.engine, "sharesOf")
    .mockResolvedValueOnce(report)
    .mockImplementationOnce(async () => {
      abort.abort(new Error("cancelled after staging"));
      return report;
    });
  vi.stubEnv("FEATURE_AUTOPILOT", "1");
  await expect(job.run(ctx)).rejects.toThrow("cancelled after staging");
  expect(store.listLatest("autopilot-position", { maxAgeMs: 60_000, now })).toHaveLength(0);
  expect(store.listLatest("autopilot-pause", { maxAgeMs: 60_000, now })).toHaveLength(0);
  expect(readDecisionLog(store)).toHaveLength(1);
});
