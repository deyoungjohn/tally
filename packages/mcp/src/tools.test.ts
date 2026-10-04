import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";
import { E18, formatUnits, type Address } from "@tally/core";
import {
  createFixtureEngine,
  fixtureTradeChain,
  fixtureWallet,
  FIXTURE_NOW,
  type Engine,
} from "@tally/engine";
import { LIQUIDMESH_ROUTER, SHAREGUARD_DEPLOYED, USDT_BSC } from "@tally/config";
import { createRuntime, unsignedEnv, type Runtime } from "./runtime";
import { registerTools } from "./tools";
import { buildGuardedSwap } from "./tools/build";
import { getConsolidatedQuote } from "./tools/quote";
import { getSharesOf } from "./tools/shares";
import { getIntegrity } from "./tools/integrity";
import { plainError } from "./errors";
import { registerOptionalTools } from "./optional";
import * as engineFactory from "@tally/engine";
import { outputJson, safeText } from "./output";

const USER = "0x1111111111111111111111111111111111111111" as Address;
const approved = () => fixtureTradeChain({ ...fixtureWallet(), allowance: 6n * E18 });
const runtime = (engine = createFixtureEngine({ tradeChain: approved() })): Runtime => ({
  engine,
  fixtures: true,
  now: () => FIXTURE_NOW,
  onWarn: vi.fn(),
});
const request = { ticker: "NVDA", issuer: "bstock", usdtAmount: 6, wallet: USER, recipient: USER };
const abi = parseAbi([
  "function swapForShares(address tokenIn, uint256 amountIn, address stock, uint256 minShares, address router, bytes routerData, address recipient, uint256 deadline) returns (uint256 shares)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

describe("MCP fixture tools", () => {
  it("get_consolidated_quote returns precisely the web engine numbers and all issuers", async () => {
    const rt = runtime();
    const expected = await rt.engine.quote({ ticker: "NVDA", amount: { usd: 6 } });
    const result = await getConsolidatedQuote(rt, { ticker: "nvda", usd: 6 });
    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) {
      const original = expected.rows.find((r) => r.issuer === row.issuer)!;
      expect(row.pricePerShare).toBe(original.usdPerShare ?? null);
      expect(row.premium).toBe(original.premium ?? null);
      expect(row.fee).toBe(original.feeUsd ?? null);
      expect(row.route).toBe(original.routeText ?? null);
      expect(row.best).toBe(original.isBest);
      expect(row.integrity).toEqual(original.integrity);
    }
    expect(result.freshness).toMatchObject({
      fixtures: true,
      source: "recorded-fixtures",
      stale: false,
    });
    const shares = await getConsolidatedQuote(rt, { ticker: "NVDA", shares: 0.01 });
    expect(shares.rows.some((r) => r.shares !== null)).toBe(true);
  });
  it("get_shares_of converts NFLX 10x vs 1x and carries unknown multiplier reasons", async () => {
    const chain = {
      ...approved(),
      erc20Balances: async (_: Address, tokens: Address[]) => tokens.map(() => E18),
    };
    const engine = createFixtureEngine({ tradeChain: chain });
    const result = await getSharesOf(runtime(engine), { address: USER, tickers: ["NFLX"] });
    expect(result.rows.find((r) => r.issuer === "ondo")).toMatchObject({
      shares: 10n * E18,
      multiplier: 10n * E18,
      source: "api",
    });
    expect(result.rows.find((r) => r.issuer === "bstock")).toMatchObject({
      shares: E18,
      sourceDetail: "on-chain uiMultiplier()",
    });
    engine.ports.facts.multipliers = async () => ({});
    const unknown = await getSharesOf(runtime(engine), { address: USER, tickers: ["NFLX"] });
    expect(unknown.rows).toHaveLength(3);
    expect(
      unknown.rows.every((r) => r.shares === null && r.reason !== null && r.multiplier === null),
    ).toBe(true);
  });
  it("get_integrity includes Trap Shield grades/reasons and ghost/paused flags", async () => {
    const rt = runtime();
    const facts = await getIntegrity(rt, { ticker: "NFLX" });
    expect(facts.rows.find((r) => r.issuer === "ondo")).toMatchObject({
      ghost: true,
      executable: false,
    });
    expect(facts.rows.find((r) => r.issuer === "xstocks")!.reasons.length).toBeGreaterThan(0);
    const missing = runtime();
    missing.engine.ports.facts.market = async () => ({ status: null });
    const unavailable = await getIntegrity(missing, { ticker: "NVDA" });
    expect(unavailable.rows.every((r) => r.paused === null && r.ghost === null)).toBe(true);
    const original = rt.engine.ports.facts.market;
    rt.engine.ports.facts.market = async (token) => ({
      ...(await original(token)),
      status: {
        kind: "paused",
        session: "closed",
        reasonCode: "ASSET_PAUSED",
        reasonMsg: "stock_split",
      },
    });
    const paused = await getIntegrity(rt, { ticker: "NVDA" });
    expect(paused.rows.every((r) => r.paused && !r.executable)).toBe(true);
  });
  it("build_guarded_swap decodes to deployed swapForShares, exact floor, allow-listed router; RPC gas x1.25 simulated at that limit", async () => {
    const chain = approved();
    const estimate = vi.spyOn(chain, "estimateGas");
    const simulate = vi.spyOn(chain, "simulate");
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network must not be used in fixture mode"));
    try {
      const plan = await buildGuardedSwap(runtime(createFixtureEngine({ tradeChain: chain })), {
        ...request,
        minShares: "0.025",
      });
      expect(plan.status).toBe("ready");
      expect(plan.tx!.to).toBe(SHAREGUARD_DEPLOYED);
      expect(plan.unsigned).toBe(true);
      expect(plan.feedUpdate).toBe(false);
      const decoded = decodeFunctionData({ abi, data: plan.tx!.data });
      expect(decoded.functionName).toBe("swapForShares");
      const [token, amount, , floor, router, , recipient] = decoded.args!;
      expect(String(token).toLowerCase()).toBe(USDT_BSC.toLowerCase());
      expect(amount).toBe(6n * E18);
      expect(floor).toBe(BigInt(plan.minShares));
      expect(floor).toBeGreaterThanOrEqual((25n * E18) / 1000n);
      expect(plan.floorShares).toBe(formatUnits(BigInt(plan.minShares), 18));
      expect(String(router).toLowerCase()).toBe(LIQUIDMESH_ROUTER.toLowerCase());
      expect(recipient).toBe(USER);
      expect(plan.tx!.gasEstimate).toBe("554149");
      expect(plan.tx!.gasLimit).toBe("692687");
      expect(simulate.mock.calls[0]![1]).toBe(692_687n);
      expect(estimate.mock.calls[0]![0].account).toBe(USER);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
  it("passes needs_funds and needs_approval through; approval decodes to exact amount and guard spender", async () => {
    const funds = await buildGuardedSwap(
      runtime(
        createFixtureEngine({
          tradeChain: fixtureTradeChain({ usdt: 0n, bnb: 0n, allowance: 0n }),
        }),
      ),
      request,
    );
    expect(funds.status).toBe("needs_funds");
    expect(funds.shortfall!.usdt).toBe((6n * E18).toString());
    expect(funds.tx).toBeUndefined();
    const engine = createFixtureEngine();
    const original = await engine.trade.prepare({
      ticker: "NVDA",
      issuer: "bstock",
      usd: 6,
      user: USER,
    });
    const result = await buildGuardedSwap(runtime(engine), request);
    expect(result.status).toBe("needs_approval");
    expect(result.approve).toEqual(original.approve);
    expect(result.tx).toBeUndefined();
    const decoded = decodeFunctionData({ abi, data: result.approve!.data });
    expect(decoded.args).toEqual([SHAREGUARD_DEPLOYED, 6n * E18]);
    expect(result.approval).toEqual({
      token: USDT_BSC,
      spender: SHAREGUARD_DEPLOYED,
      amount: (6n * E18).toString(),
    });
  });
  it("derives a floor meeting intent with bigint basis points and refuses a fresh plan below it", async () => {
    const rt = runtime();
    const q = await rt.engine.quote({ ticker: "NVDA", amount: { usd: 6 } });
    const quoted = q.rows.find((r) => r.issuer === "bstock")!.sharesOut!;
    const target = (quoted * 9900n) / 10_000n;
    const p = await buildGuardedSwap(rt, { ...request, minShares: formatUnits(target, 18) });
    expect(BigInt(p.minShares)).toBeGreaterThanOrEqual(target);
    expect(p.tolerancePct).toBeGreaterThanOrEqual(0.1);
    expect(p.tolerancePct).toBeLessThanOrEqual(5);
    await expect(buildGuardedSwap(rt, { ...request, minShares: "1" })).rejects.toMatchObject({
      kind: "floor_not_achievable",
    });
    const actual = rt.engine.trade.prepare;
    vi.spyOn(rt.engine.trade, "prepare").mockImplementation(async (r) => ({
      ...(await actual(r)),
      minShares: "1",
    }));
    await expect(buildGuardedSwap(rt, { ...request, minShares: "0.025" })).rejects.toMatchObject({
      kind: "floor_not_achievable",
      message: expect.stringContaining("0.000000000000000001 shares"),
    });
  });
  it("refuses a different recipient and invalid floor/tolerance before prepare", async () => {
    const rt = runtime();
    const prepare = vi.spyOn(rt.engine.trade, "prepare");
    for (const args of [
      { ...request, recipient: "0x2222222222222222222222222222222222222222" },
      { ...request, minShares: "0.02", tolerancePct: 1 },
      { ...request, minShares: "0.0000000000000000001" },
      { ...request, tolerancePct: 6 },
      { ...request, issuer: "xstocks" },
      { ...request, usdtAmount: 5 },
    ]) {
      await expect(buildGuardedSwap(rt, args)).rejects.toThrow();
    }
    expect(prepare).not.toHaveBeenCalled();
  });
  it("never reads FEED_SIGNER_PK, constructs a signer-free engine, and refuses Ondo requiring an update", async () => {
    const forbidden = vi.fn(() => {
      throw new Error("must never read the feed signer");
    });
    const env = { TALLY_FIXTURES: "1" };
    Object.defineProperty(env, "FEED_SIGNER_PK", { enumerable: true, get: forbidden });
    expect(unsignedEnv(env)).toEqual({ TALLY_FIXTURES: "1" });
    expect(createRuntime(env, vi.fn()).fixtures).toBe(true);
    expect(forbidden).not.toHaveBeenCalled();
    const liveEnv = {};
    Object.defineProperty(liveEnv, "FEED_SIGNER_PK", { enumerable: true, get: forbidden });
    const live = vi.spyOn(engineFactory, "createLiveEngine").mockReturnValue(createFixtureEngine());
    try {
      expect(createRuntime(liveEnv, vi.fn()).fixtures).toBe(false);
      expect(live.mock.calls[0]![0]).not.toHaveProperty("FEED_SIGNER_PK");
      expect(forbidden).not.toHaveBeenCalled();
    } finally {
      live.mockRestore();
    }
    const chain = approved();
    const read = chain.readGuard;
    chain.readGuard = async (s, r) => ({
      ...(await read(s, r)),
      sharesPerToken: undefined,
      sharesPerTokenError: "FeedStale",
    });
    const result = await registerTools(runtime(createFixtureEngine({ tradeChain: chain }))).call(
      "build_guarded_swap",
      { ...request, issuer: "ondo" },
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      kind: "share_data_refreshing",
      message: expect.stringContaining("Use the web app"),
    });
    expect(result.content[0]!.text).not.toContain("signature");
  });
  it("fresh stored Ondo feed uses unsigned swapForShares", async () => {
    const plan = await buildGuardedSwap(runtime(), { ...request, issuer: "ondo" });
    expect(plan.feedUpdate).toBe(false);
    expect(decodeFunctionData({ abi, data: plan.tx!.data }).functionName).toBe("swapForShares");
  });
  it("diagnostic output omits transport URLs and preserves public transaction links", () => {
    const transport = "https://rpc.invalid/private-provider-path";
    expect(safeText(`source failed at ${transport}`)).toBe("source failed at [source URL omitted]");
    const publicLink = `https://bscscan.com/tx/0x${"1".repeat(64)}`;
    const encoded = outputJson({
      warning: transport,
      bscscan: publicLink,
      shares: 123_456_789_123_456_789n,
    });
    expect(encoded).not.toContain(transport);
    expect(JSON.parse(encoded)).toEqual({
      warning: "[source URL omitted]",
      bscscan: publicLink,
      shares: "123456789123456789",
    });
  });
  it("maps recorded region block, minimum, paused and ghost errors to plain messages", async () => {
    const blocked = registerTools(runtime(createFixtureEngine({ blockRegion: true })));
    const region = await blocked.call("get_consolidated_quote", { ticker: "NVDA", usd: 6 });
    expect(region.isError).toBe(true);
    expect(JSON.parse(region.content[0]!.text).kind).toBe("region_block");
    const tools = registerTools(runtime());
    const minimum = await tools.call("get_consolidated_quote", { ticker: "NVDA", usd: 5 });
    expect(JSON.parse(minimum.content[0]!.text)).toEqual({
      kind: "below_minimum",
      message: "Minimum order is 6 USDT.",
    });
    const ghost = await tools.call("build_guarded_swap", {
      ...request,
      ticker: "NFLX",
      issuer: "ondo",
    });
    expect(JSON.parse(ghost.content[0]!.text).kind).toBe("ghost");
    const paused = await registerTools(
      runtime(
        createFixtureEngine({
          tradeChain: fixtureTradeChain({ ...fixtureWallet(), tokenPaused: true }),
        }),
      ),
    ).call("build_guarded_swap", request);
    expect(JSON.parse(paused.content[0]!.text).kind).toBe("paused");
    expect(plainError({ code: 40375 })).toMatchObject({ kind: "below_minimum" });
    expect(plainError({ code: "40304" })).toMatchObject({ kind: "region_block" });
  });
  it("primary quote source down returns a plain error; stale snapshot retains its age and warns", async () => {
    const rt = runtime();
    const q = await rt.engine.quote({ ticker: "NVDA", amount: { usd: 6 } });
    vi.spyOn(rt.engine, "quote").mockResolvedValue({
      ...q,
      asOf: new Date(FIXTURE_NOW - 60_000).toISOString(),
    });
    const stale = await getConsolidatedQuote(rt, { ticker: "NVDA", usd: 6 });
    expect(stale.freshness).toMatchObject({
      ageMs: 60_000,
      stale: true,
      reason: expect.any(String),
    });
    expect(rt.onWarn).toHaveBeenCalled();
    const down = runtime();
    vi.spyOn(down.engine.ports.quotes, "quote").mockRejectedValue(new Error("upstream down"));
    const failed = await registerTools(down).call("get_consolidated_quote", {
      ticker: "NVDA",
      usd: 6,
    });
    expect(failed.isError).toBe(true);
    expect(JSON.parse(failed.content[0]!.text).message).toContain("temporarily unavailable");
  });
  it("expired trade plans are rejected", async () => {
    const rt = runtime();
    const p = await rt.engine.trade.prepare({
      ticker: "NVDA",
      issuer: "bstock",
      usd: 6,
      user: USER,
    });
    vi.spyOn(rt.engine.trade, "prepare").mockResolvedValue({
      ...p,
      builtAt: FIXTURE_NOW - 60_000,
      expiresAt: FIXTURE_NOW - 45_000,
    });
    await expect(buildGuardedSwap(rt, request)).rejects.toMatchObject({ kind: "expired" });
  });
  it("invalid and unknown tool calls are MCP errors; bigint serialization preserves precision", async () => {
    const tools = registerTools(runtime());
    expect((await tools.call("missing", {})).isError).toBe(true);
    expect(
      (await tools.call("get_consolidated_quote", { ticker: "NVDA", usd: 6, shares: 1 })).isError,
    ).toBe(true);
    expect((await tools.call("get_shares_of", { address: USER, tickers: [] })).isError).toBe(true);
    const result = await tools.call("get_shares_of", { address: USER, tickers: ["NVDA"] });
    const value = JSON.parse(result.content[0]!.text);
    expect(value.rows.find((r: { issuer: string }) => r.issuer === "bstock").balance).toBe(
      "25654736000000000",
    );
  });
  it("optional modules absent keeps core tools; present modules dynamically register; broken modules surface", async () => {
    const rt = runtime();
    const tools = registerTools(rt);
    const load = vi.fn();
    await registerOptionalTools(tools, rt, load, () => false);
    expect(load).not.toHaveBeenCalled();
    expect(tools.list()).toHaveLength(4);
    expect(rt.onWarn).toHaveBeenCalledTimes(3);
    const register = vi.fn((_registry: unknown, _engine: Engine) => undefined);
    await registerOptionalTools(
      tools,
      rt,
      async () => ({ register }),
      () => true,
    );
    expect(register).toHaveBeenCalledTimes(3);
    expect(register).toHaveBeenCalledWith(tools, rt.engine);
    await expect(
      registerOptionalTools(
        tools,
        rt,
        async () => ({}),
        () => true,
      ),
    ).rejects.toThrow("must export register");
  });
});
