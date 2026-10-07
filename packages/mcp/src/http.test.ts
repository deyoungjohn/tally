import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request, type Server, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createFixtureEngine, fixtureTradeChain, fixtureWallet, FIXTURE_NOW } from "@tally/engine";
import { E18, type Address } from "@tally/core";
import { decodeFunctionData, parseAbi } from "viem";
import { SHAREGUARD_DEPLOYED, LIQUIDMESH_ROUTER } from "@tally/config";
import { unsignedEnv, type Runtime } from "./runtime";
import { registerTools } from "./tools";
import { registerOptionalTools } from "./optional";
import { createHttpServer, startHttpServer, type HttpOptions } from "./http";

const USER = "0x1111111111111111111111111111111111111111" as Address;
const servers: Server[] = [];
const env = {
  TALLY_MCP_HTTP: "1",
  TALLY_FIXTURES: "1",
  TALLY_ALLOW_MISSING_GEO: "1",
  TALLY_MCP_HTTP_PORT: "0",
};
type Reply = {
  fixtures?: boolean;
  ok?: boolean;
  kind?: string;
  message?: string;
  error?: { message: string; data?: unknown };
  result?: {
    fixtures: boolean;
    tools?: { name: string }[];
    isError?: boolean;
    content?: { text: string }[];
  };
};
const rpc = (method: string, params?: unknown) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  ...(params ? { params } : {}),
});

async function start(options: HttpOptions = {}) {
  const server = await startHttpServer({
    ...options,
    env: { ...env, ...options.env },
    log: options.log ?? vi.fn(),
  });
  servers.push(server);
  return server;
}
function url(server: Server) {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}
function send(
  server: Server,
  body: unknown = rpc("tools/list"),
  headers: Record<string, string> = {},
  path = "/mcp",
  method = "POST",
) {
  const bytes = typeof body === "string" ? body : JSON.stringify(body);
  return new Promise<{ status: number; body: Reply; text: string; headers: IncomingHttpHeaders }>(
    (resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port: (server.address() as AddressInfo).port,
          path,
          method,
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            ...headers,
          },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            text += chunk;
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              body: JSON.parse(text || "{}") as Reply,
              text,
              headers: res.headers,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(method === "POST" ? bytes : undefined);
    },
  );
}
const call = (
  server: Server,
  name: string,
  args: unknown = {},
  headers: Record<string, string> = {},
) => send(server, rpc("tools/call", { name, arguments: args }), headers);
const rt = (
  engine = createFixtureEngine({
    tradeChain: fixtureTradeChain({ ...fixtureWallet(), allowance: 6n * E18 }),
  }),
): Runtime => ({ engine, fixtures: true, now: () => FIXTURE_NOW, onWarn: vi.fn() });

beforeEach(() => {
  vi.stubEnv("FEATURE_SELL", "0");
  vi.stubEnv("FEATURE_RECEIPTS", "0");
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("opt-in loopback HTTP MCP", () => {
  it("requires the environment switch and binds only 127.0.0.1", async () => {
    expect(() => createHttpServer({ env: {} })).toThrow("HTTP MCP is disabled");
    expect(() => createHttpServer({ env: { ...env, TALLY_MCP_HTTP_CONCURRENCY: "0" } })).toThrow(
      "configuration is invalid",
    );
    const server = await start({ env: { TALLY_MCP_HTTP_HOST: "0.0.0.0" } });
    expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
    const health = await send(server, {}, {}, "/healthz", "GET");
    expect(health).toMatchObject({ status: 200, body: { ok: true, fixtures: true } });
    const disabled = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", "--http"], {
      cwd: process.cwd(),
      env: { ...unsignedEnv(process.env), TALLY_MCP_HTTP: "0" },
      encoding: "utf8",
    });
    expect(disabled.status).toBe(1);
    expect(disabled.stdout).toBe("");
    expect(disabled.stderr).not.toMatch(/stack|https?:|FEED_SIGNER/);
  });
  it("lists the same registry and calls the same fixture quote; every result identifies fixtures", async () => {
    const runtime = rt();
    const registry = registerTools(runtime);
    await registerOptionalTools(registry, runtime);
    const server = await start({ runtime });
    const listed = await send(server);
    expect(listed.status).toBe(200);
    expect(listed.body.result!.fixtures).toBe(true);
    expect(listed.body.result!.tools!.map((tool) => tool.name)).toEqual(
      registry.list().map((tool) => tool.name),
    );
    const quote = await call(server, "get_consolidated_quote", { ticker: "NVDA", usd: 6 });
    expect(quote.status).toBe(200);
    expect(quote.body.result!.fixtures).toBe(true);
    const value = JSON.parse(quote.body.result!.content![0]!.text);
    const expected = await registry.call("get_consolidated_quote", { ticker: "NVDA", usd: 6 });
    expect(value).toEqual({ ...JSON.parse(expected.content[0]!.text), fixtures: true });
    expect(value.freshness.source).toBe("recorded-fixtures");
    const invalid = await call(server, "get_consolidated_quote", {});
    expect(invalid.body.result!.isError).toBe(true);
    expect(JSON.parse(invalid.body.result!.content![0]!.text).fixtures).toBe(true);
  });
  it("an actual MCP HTTP client initializes and calls tools; each request uses a fresh transport", async () => {
    const starts = vi.spyOn(StreamableHTTPServerTransport.prototype, "start");
    const server = await start();
    const client = new Client({ name: "http-fixture-test", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(url(server))));
      expect((await client.listTools()).tools).toHaveLength(4);
      const quote = await client.callTool({
        name: "get_consolidated_quote",
        arguments: { ticker: "NVDA", usd: 6 },
      });
      expect(quote.isError).not.toBe(true);
      expect(JSON.parse((quote.content as { text: string }[])[0]!.text).fixtures).toBe(true);
      const independent = await send(server, rpc("tools/list"), {
        "mcp-session-id": "another-client",
      });
      expect(independent.status).toBe(200);
      expect(independent.headers["mcp-session-id"]).toBeUndefined();
      expect(starts.mock.calls.length).toBeGreaterThanOrEqual(4);
      expect(new Set(starts.mock.contexts).size).toBe(starts.mock.calls.length);
    } finally {
      await client.close();
    }
  });
  it("HTTP retains stale snapshot facts and maps primary-source failures without diagnostics", async () => {
    const runtime = rt();
    const quote = await runtime.engine.quote({ ticker: "NVDA", amount: { usd: 6 } });
    vi.spyOn(runtime.engine, "quote").mockResolvedValue({
      ...quote,
      asOf: new Date(FIXTURE_NOW - 60_000).toISOString(),
    });
    const server = await start({ runtime });
    const stale = await call(server, "get_consolidated_quote", { ticker: "NVDA", usd: 6 });
    expect(JSON.parse(stale.body.result!.content![0]!.text)).toMatchObject({
      fixtures: true,
      freshness: { ageMs: 60_000, stale: true, reason: expect.any(String) },
    });
    expect(runtime.onWarn).toHaveBeenCalled();
    const down = rt();
    vi.spyOn(down.engine.ports.quotes, "quote").mockRejectedValue(
      new Error("private-diagnostic /private/path https://provider.invalid/private-path"),
    );
    const failed = await call(await start({ runtime: down }), "get_consolidated_quote", {
      ticker: "NVDA",
      usd: 6,
    });
    expect(failed.body.result!.isError).toBe(true);
    expect(JSON.parse(failed.body.result!.content![0]!.text)).toEqual({
      kind: "unavailable",
      message: "Tally data is temporarily unavailable. No transaction was sent.",
      fixtures: true,
    });
    expect(failed.text).not.toMatch(/private-diagnostic|\/private\/|provider|https?:/);
  });
  it("missing live credentials still allow health and return only the mapped auth error", async () => {
    const server = await start({ env: { TALLY_FIXTURES: "0" } });
    expect((await send(server, {}, {}, "/healthz", "GET")).body).toEqual({
      ok: true,
      fixtures: false,
    });
    const failed = await call(server, "get_consolidated_quote", { ticker: "NVDA", usd: 6 });
    expect(failed).toMatchObject({
      status: 503,
      body: {
        kind: "auth",
        message:
          "Data-provider credentials are not set in this environment. Load the Tally API credentials, then retry. No transaction was sent.",
        fixtures: false,
      },
    });
    expect(failed.text).not.toMatch(/BINANCE_|https?:|stack|\/home\//);
  });
  it("HTTP plans off hides and refuses buy and sell even when FEATURE_SELL is on", async () => {
    vi.stubEnv("FEATURE_SELL", "1");
    const runtime = rt();
    const prepare = vi.spyOn(runtime.engine.trade, "prepare");
    const sell = vi.spyOn(runtime.engine.trade, "prepareSell");
    const server = await start({ runtime, env: { TALLY_MCP_HTTP_PLANS: "0" } });
    const listed = await send(server);
    expect(listed.body.result!.tools!.map((tool) => tool.name)).not.toContain("build_guarded_swap");
    expect(listed.body.result!.tools!.map((tool) => tool.name)).not.toContain("build_sell_swap");
    for (const name of ["build_guarded_swap", "build_sell_swap"]) {
      const result = await call(server, name);
      expect(result.body.result!.isError).toBe(true);
      expect(JSON.parse(result.body.result!.content![0]!.text)).toMatchObject({
        kind: "plans_disabled",
        fixtures: true,
      });
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(sell).not.toHaveBeenCalled();
  });
  it("preserves sell and receipt feature flags and adds fixtures to optional tool results", async () => {
    const server = await start();
    expect(
      (await send(server)).body.result!.tools!.some((tool) => tool.name === "build_sell_swap"),
    ).toBe(false);
    vi.stubEnv("FEATURE_SELL", "1");
    vi.stubEnv("FEATURE_RECEIPTS", "1");
    const listed = await send(server);
    expect(listed.body.result!.tools!.map((tool) => tool.name)).toContain("build_sell_swap");
    expect(listed.body.result!.tools!.map((tool) => tool.name)).toContain("get_receipt");
    const invalid = await call(server, "get_receipt", {});
    expect(JSON.parse(invalid.body.result!.content![0]!.text).fixtures).toBe(true);
  });
  it.each([
    { "cf-ipcountry": "US" },
    { "cf-ipcountry": "UA", "cf-region-code": "43" },
    { "cf-ipcountry": "T1" },
    { "cf-ipcountry": "XX" },
    { "cf-ipcountry": "US, NG" },
  ])("blocks region %j before any tool is reached", async (headers) => {
    const runtime = rt();
    const quote = vi.spyOn(runtime.engine, "quote");
    const server = await start({ runtime });
    expect(
      (
        await call(
          server,
          "get_consolidated_quote",
          { ticker: "NVDA", usd: 6 },
          headers as Record<string, string>,
        )
      ).status,
    ).toBe(451);
    expect(quote).not.toHaveBeenCalled();
  });
  it("missing geography or verified client IP fails closed; local override alone permits socket fallback", async () => {
    const closed = await start({ env: { TALLY_ALLOW_MISSING_GEO: "0" } });
    expect((await send(closed)).status).toBe(451);
    expect((await send(closed, rpc("tools/list"), { "cf-ipcountry": "NG" })).status).toBe(451);
    expect(
      (
        await send(closed, rpc("tools/list"), {
          "cf-ipcountry": "NG",
          "cf-connecting-ip": "192.0.2.1",
        })
      ).status,
    ).toBe(200);
    expect((await send(await start())).status).toBe(200);
  });
  it("rate limits each verified client, trips with Retry-After and recovers after one minute", async () => {
    let clock = 1000;
    const server = await start({ env: { TALLY_MCP_HTTP_RATE_LIMIT: "2" }, now: () => clock });
    const headers = { "cf-connecting-ip": "192.0.2.1" };
    expect((await send(server, {}, headers, "/healthz", "GET")).status).toBe(200);
    expect((await send(server, {}, headers, "/healthz", "GET")).status).toBe(200);
    const limited = await send(server, {}, headers, "/healthz", "GET");
    expect(limited).toMatchObject({ status: 429, body: { kind: "rate_limited", fixtures: true } });
    expect(limited.headers["retry-after"]).toBe("60");
    expect(
      (await send(server, {}, { "cf-connecting-ip": "192.0.2.2" }, "/healthz", "GET")).status,
    ).toBe(200);
    clock += 60_000;
    expect((await send(server, {}, headers, "/healthz", "GET")).status).toBe(200);
  });
  it.each([{}, { "transfer-encoding": "chunked" }])(
    "rejects oversized bodies %j before tool access",
    async (headers) => {
      const server = await start();
      const reply = await send(
        server,
        JSON.stringify({ padding: "x".repeat(65 * 1024) }),
        headers as Record<string, string>,
      );
      expect(reply).toMatchObject({
        status: 413,
        body: { kind: "body_too_large", fixtures: true },
      });
    },
  );
  it("times out plainly; timed-out work still holds its concurrency slot until it settles", async () => {
    const runtime = rt();
    const quoted = await runtime.engine.quote({ ticker: "NVDA", amount: { usd: 6 } });
    let finish!: (value: typeof quoted) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(runtime.engine, "quote").mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const server = await start({
      runtime,
      timeoutMs: 250,
      env: { TALLY_MCP_HTTP_CONCURRENCY: "1" },
    });
    const slow = call(server, "get_consolidated_quote", { ticker: "NVDA", usd: 6 });
    await started;
    expect((await send(server)).status).toBe(503);
    const reply = await slow;
    expect(reply).toMatchObject({
      status: 504,
      body: {
        kind: "timeout",
        fixtures: true,
        message: "The tool timed out. No transaction was sent.",
      },
    });
    expect(reply.text).not.toMatch(/stack|https?:|\/home\/|BINANCE/);
    expect((await send(server)).status).toBe(503);
    finish(quoted);
    await new Promise((resolve) => setImmediate(resolve));
    expect((await send(server)).status).toBe(200);
  });
  it("rejects wrong Origin; exact allow-list and absent Origin work", async () => {
    const server = await start({ env: { TALLY_MCP_HTTP_ORIGINS: "https://agent.example" } });
    expect(
      (await send(server, rpc("tools/list"), { origin: "https://wrong.example" })).status,
    ).toBe(403);
    expect(
      (await send(server, rpc("tools/list"), { origin: "https://agent.example.evil" })).status,
    ).toBe(403);
    const allowed = await send(server, rpc("tools/list"), { origin: "https://agent.example" });
    expect(allowed.status).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://agent.example");
    expect((await send(server)).status).toBe(200);
  });
  it("optional Bearer authentication rejects absent, wrong and different-length values without logging them", async () => {
    // Public test marker, never a real credential.
    const marker = "public-fixture-auth-marker";
    const log = vi.fn();
    const server = await start({ env: { TALLY_MCP_HTTP_KEY: marker }, log });
    for (const authorization of [
      "",
      "Bearer wrong",
      "Basic other",
      "Bearer a-different-length-marker",
    ]) {
      const reply = await send(server, rpc("tools/list"), { authorization });
      expect(reply).toMatchObject({ status: 401, body: { kind: "auth", fixtures: true } });
      expect(reply.text).not.toContain(marker);
    }
    expect(
      (await send(server, rpc("tools/list"), { authorization: `Bearer ${marker}` })).status,
    ).toBe(200);
    expect(log.mock.calls.flat().join("\n")).not.toMatch(/marker|Bearer|Basic|wrong/);
  });
  it("logs only method, known tool and status; raw optional sell errors cannot leak", async () => {
    vi.stubEnv("FEATURE_SELL", "1");
    const runtime = rt();
    vi.spyOn(runtime.engine.trade, "prepareSell").mockRejectedValue(
      new Error("private-diagnostic at /private/path https://provider.invalid/private-path"),
    );
    const log = vi.fn();
    const server = await start({ runtime, log });
    const reply = await call(server, "build_sell_swap", {
      ticker: "NVDA",
      issuer: "bstock",
      wallet: USER,
      shares: 0.1,
    });
    expect(reply.body.result!.isError).toBe(true);
    expect(reply.text).not.toMatch(/private-diagnostic|\/private\/|provider/);
    await call(server, "get_shares_of", { address: USER, tickers: ["NVDA"] });
    const logs = log.mock.calls.flat().join("\n");
    expect(logs).toContain("method=POST tool=build_sell_swap status=200");
    expect(logs).not.toContain(USER);
    expect(logs).not.toMatch(/arguments|shares=|private-diagnostic|\/private\/|https?:/);
  });
  it("only serves POST /mcp and GET /healthz; malformed protocol data stays plain", async () => {
    const server = await start();
    expect((await send(server, {}, {}, "/other")).status).toBe(404);
    expect((await send(server, {}, {}, "/mcp", "GET")).status).toBe(405);
    expect((await send(server, {}, {}, "/healthz")).status).toBe(405);
    expect((await send(server, "not-json")).status).toBe(400);
    expect((await send(server, [rpc("tools/list"), rpc("tools/list")])).status).toBe(400);
    const wrong = await send(server, rpc("tools/call", { name: 1, arguments: { wallet: USER } }));
    expect(wrong.text).not.toContain(USER);
    expect(wrong.body.error?.data).toEqual({ fixtures: true });
  });
  it("HTTP never reads the signer or reaches live fetch/sign/send; plans decode to unsigned guard calls", async () => {
    const forbidden = vi.fn(() => {
      throw new Error("Signer must not be read");
    });
    const safeEnv = { ...env };
    Object.defineProperty(safeEnv, "FEED_SIGNER_PK", { enumerable: true, get: forbidden });
    const factoryServer = await startHttpServer({ env: safeEnv, log: vi.fn() });
    servers.push(factoryServer);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Live fetch is forbidden"));
    expect((await send(factoryServer)).status).toBe(200);
    expect(forbidden).not.toHaveBeenCalled();
    const runtime = rt();
    const server = await start({ runtime });
    const reply = await call(server, "build_guarded_swap", {
      ticker: "NVDA",
      issuer: "bstock",
      usdtAmount: 6,
      wallet: USER,
    });
    const plan = JSON.parse(reply.body.result!.content![0]!.text);
    expect(plan).toMatchObject({
      status: "ready",
      unsigned: true,
      fixtures: true,
      feedUpdate: false,
    });
    expect(plan.tx.to.toLowerCase()).toBe(SHAREGUARD_DEPLOYED.toLowerCase());
    const decoded = decodeFunctionData({
      abi: parseAbi([
        "function swapForShares(address tokenIn, uint256 amountIn, address stock, uint256 minShares, address router, bytes routerData, address recipient, uint256 deadline) returns (uint256 shares)",
      ]),
      data: plan.tx.data,
    });
    expect(decoded.functionName).toBe("swapForShares");
    expect(decoded.args[4].toLowerCase()).toBe(LIQUIDMESH_ROUTER.toLowerCase());
    expect(decoded.args[6].toLowerCase()).toBe(USER.toLowerCase());
    expect(reply.text).not.toMatch(/signature|privateKey|FEED_SIGNER/);
    for (const name of ["sign", "send_transaction", "broadcast"]) {
      const refused = await call(server, name);
      expect(JSON.parse(refused.body.result!.content![0]!.text).kind).toBe("unknown_tool");
    }
    const chain = fixtureTradeChain();
    const read = chain.readGuard;
    chain.readGuard = async (stock, user) => ({
      ...(await read(stock, user)),
      sharesPerToken: undefined,
      sharesPerTokenError: "FeedStale",
    });
    const stale = await start({ runtime: rt(createFixtureEngine({ tradeChain: chain })) });
    const blocked = await call(stale, "build_guarded_swap", {
      ticker: "NVDA",
      issuer: "ondo",
      usdtAmount: 6,
      wallet: USER,
    });
    expect(JSON.parse(blocked.body.result!.content![0]!.text).kind).toBe("share_data_refreshing");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("stdio still initializes and quotes unchanged even when HTTP env is on without --http", async () => {
    const safe = Object.fromEntries(
      Object.entries(unsignedEnv(process.env)).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    const client = new Client({ name: "stdio-regression", version: "1" });
    try {
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: ["--import", "tsx", "src/index.ts"],
          cwd: process.cwd(),
          env: { ...safe, TALLY_FIXTURES: "1", TALLY_MCP_HTTP: "1" },
          stderr: "pipe",
        }),
      );
      expect((await client.listTools()).tools).toHaveLength(4);
      const quote = await client.callTool({
        name: "get_consolidated_quote",
        arguments: { ticker: "NVDA", usd: 6 },
      });
      expect(quote.isError).not.toBe(true);
      expect(JSON.parse((quote.content as { text: string }[])[0]!.text).freshness.fixtures).toBe(
        true,
      );
    } finally {
      await client.close();
    }
  }, 15_000);
});
