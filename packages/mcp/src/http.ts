import { createServer as createNodeServer, type IncomingMessage } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  JSONRPCMessageSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import { evaluateRegion } from "@tally/config";
import { createRuntime, unsignedEnv, type Runtime } from "./runtime";
import { ToolRegistry } from "./registry";
import { registerTools } from "./tools";
import { registerOptionalTools } from "./optional";
import { plainError, ToolError } from "./errors";
import { outputJson } from "./output";

const BODY_LIMIT = 64 * 1024;
const WINDOW_MS = 60_000;
const TIMEOUT_MS = 15_000;
const CLIENT_LIMIT = 10_000;
const PLAN_TOOLS = new Set(["build_guarded_swap", "build_sell_swap"]);

export interface HttpOptions {
  env?: Record<string, string | undefined>;
  /** Dependency injection for offline tests; production always uses createRuntime(unsignedEnv(env)). */
  runtime?: Runtime;
  now?: () => number;
  timeoutMs?: number;
  log?: (line: string) => void;
}

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  const result = value === undefined ? fallback : /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw new ToolError("invalid_config", "HTTP configuration is invalid.");
  return result;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === "string" ? value : undefined;
}

function readBody(req: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    function cleanup() {
      req.off("data", data);
      req.off("end", end);
      req.off("error", fail);
      signal.removeEventListener("abort", abort);
    }
    function fail(error: unknown) {
      cleanup();
      reject(error);
    }
    function abort() {
      fail(new ToolError("timeout", "The tool timed out. No transaction was sent."));
    }
    function data(chunk: Buffer) {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        fail(new ToolError("body_too_large", "Request exceeds the 64 KiB limit."));
        req.resume();
      } else chunks.push(chunk);
    }
    function end() {
      cleanup();
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (Array.isArray(value) || !JSONRPCMessageSchema.safeParse(value).success)
          throw new Error("Invalid protocol message");
        resolve(value);
      } catch {
        reject(new ToolError("invalid_request", "Provide one valid JSON-RPC message."));
      }
    }
    req.on("data", data);
    req.once("end", end);
    req.once("error", fail);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Creates an unbound HTTP server. Only startHttpServer binds, always to loopback. */
export function createHttpServer(options: HttpOptions = {}) {
  const env = unsignedEnv(options.env ?? process.env);
  if (env.TALLY_MCP_HTTP !== "1")
    throw new ToolError("disabled", "HTTP MCP is disabled. Set TALLY_MCP_HTTP=1 and use --http.");
  const fixtures = options.runtime?.fixtures ?? env.TALLY_FIXTURES === "1";
  const allowMissing = env.TALLY_ALLOW_MISSING_GEO === "1";
  const plans = env.TALLY_MCP_HTTP_PLANS !== "0";
  const limit = integer(env.TALLY_MCP_HTTP_RATE_LIMIT, 60, 1, 100_000);
  const globalLimit = integer(env.TALLY_MCP_HTTP_GLOBAL_LIMIT, 300, 1, 100_000);
  const maxConcurrent = integer(env.TALLY_MCP_HTTP_CONCURRENCY, 8, 1, 128);
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const origins = new Set(
    (env.TALLY_MCP_HTTP_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const key = env.TALLY_MCP_HTTP_KEY;
  if (key === "") throw new ToolError("invalid_config", "HTTP configuration is invalid.");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const keyDigest = key === undefined ? undefined : digest(key);
  const clients = new Map<string, { count: number; resetAt: number }>();
  const global = { count: 0, resetAt: 0 };
  let active = 0;
  let runtime = options.runtime;

  const http = createNodeServer((req, res) => {
    let tool = "-";
    const method = req.method === "GET" || req.method === "POST" ? req.method : "OTHER";
    res.once("finish", () =>
      log(`tally-http method=${method} tool=${tool} status=${res.statusCode}`),
    );
    const fail = (status: number, kind: string, message: string) => {
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(status, {
        "Content-Type": "application/json",
        Connection: "close",
        "Cache-Control": "no-store",
      });
      res.end(outputJson({ ...plainError(new ToolError(kind, message)), fixtures }));
      req.resume();
    };
    const path = req.url;
    if (path !== "/mcp" && path !== "/healthz")
      return fail(404, "not_found", "Endpoint not found.");
    const expected = path === "/mcp" ? "POST" : "GET";
    if (req.method !== expected) {
      res.setHeader("Allow", expected);
      return fail(405, "method_not_allowed", "Method not allowed.");
    }
    const country = header(req, "cf-ipcountry");
    if (
      (country !== undefined &&
        country.trim() !== "" &&
        !/^(?:[a-z]{2}|T1)$/i.test(country.trim())) ||
      evaluateRegion(
        { country, regionCode: header(req, "cf-region-code") },
        { allowMissingHeader: allowMissing },
      ).blocked
    )
      return fail(451, "region_block", "Access is unavailable in this region.");
    const origin = header(req, "origin");
    if (origin !== undefined && !origins.has(origin))
      return fail(403, "origin_rejected", "Origin is not allowed.");
    if (keyDigest) {
      const authorization = header(req, "authorization") ?? "";
      const candidate = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!timingSafeEqual(keyDigest, digest(candidate)))
        return fail(401, "auth", "HTTP authentication is required.");
    }
    const forwarded = header(req, "cf-connecting-ip");
    const ip =
      forwarded && isIP(forwarded)
        ? forwarded
        : allowMissing
          ? req.socket.remoteAddress
          : undefined;
    if (!ip) return fail(451, "missing_client", "Verified client information is missing.");
    const timestamp = now();
    if (path === "/mcp") {
      if (global.resetAt <= timestamp) {
        global.count = 0;
        global.resetAt = timestamp + WINDOW_MS;
      }
      if (global.count >= globalLimit) {
        res.setHeader(
          "Retry-After",
          String(Math.max(1, Math.ceil((global.resetAt - timestamp) / 1000))),
        );
        return fail(503, "busy", "The service is busy. Retry later.");
      }
      global.count++;
    }
    // Both the clock window and the number of remembered clients are bounded.
    for (const [client, bucket] of clients) if (bucket.resetAt <= timestamp) clients.delete(client);
    let bucket = clients.get(ip);
    if (!bucket) {
      if (clients.size >= CLIENT_LIMIT)
        return fail(503, "busy", "The service is busy. Retry later.");
      bucket = { count: 0, resetAt: timestamp + WINDOW_MS };
      clients.set(ip, bucket);
    }
    if (++bucket.count > limit) {
      res.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000))),
      );
      return fail(429, "rate_limited", "Request limit reached. Retry later.");
    }
    if (path === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(outputJson({ ok: true, fixtures }));
      return;
    }
    if (active >= maxConcurrent) return fail(503, "busy", "The service is busy. Retry later.");
    const length = header(req, "content-length");
    if (length && Number(length) > BODY_LIMIT)
      return fail(413, "body_too_large", "Request exceeds the 64 KiB limit.");
    const accept = header(req, "accept") ?? "";
    if (!accept.includes("application/json") || !accept.includes("text/event-stream"))
      return fail(
        406,
        "invalid_request",
        "Accept must include application/json and text/event-stream.",
      );
    if (header(req, "content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
      return fail(415, "invalid_request", "Content-Type must be application/json.");
    const protocol = header(req, "mcp-protocol-version");
    if (protocol && !SUPPORTED_PROTOCOL_VERSIONS.includes(protocol))
      return fail(400, "invalid_request", "MCP protocol version is not supported.");

    active++;
    const abort = new AbortController();
    let server: Server | undefined;
    let transport: StreamableHTTPServerTransport | undefined;
    let running: Promise<unknown> | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new ToolError("timeout", "The tool timed out. No transaction was sent."));
      }, options.timeoutMs ?? TIMEOUT_MS);
    });
    const work = async () => {
      const body = await readBody(req, abort.signal);
      runtime ??= createRuntime(env, () => log("tally-http method=INTERNAL tool=- status=warning"));
      const registry = registerTools(runtime, new ToolRegistry());
      await registerOptionalTools(registry, runtime);
      if (abort.signal.aborted) return;
      server = new Server({ name: "tally", version: "0.1.0" }, { capabilities: { tools: {} } });
      const listed = registry
        .list()
        .filter((definition) => plans || !PLAN_TOOLS.has(definition.name));
      const known = new Set(registry.list().map((definition) => definition.name));
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listed, fixtures }));
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        if (abort.signal.aborted)
          throw new ToolError("timeout", "The tool timed out. No transaction was sent.");
        const name = request.params.name;
        tool = known.has(name) ? name : "-";
        if (!plans && PLAN_TOOLS.has(name))
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: outputJson({
                  kind: "plans_disabled",
                  message: "Plan tools are disabled for HTTP.",
                  fixtures,
                }),
              },
            ],
            fixtures,
          };
        running = registry.call(name, request.params.arguments ?? {});
        const result = (await running) as Awaited<ReturnType<ToolRegistry["call"]>>;
        const value = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
        // The optional sell wrapper currently retains arbitrary upstream text. Never expose it over HTTP.
        const safe =
          result.isError && value.kind === "sell_failed"
            ? plainError({ kind: "sell_failed" })
            : value;
        return {
          ...result,
          fixtures,
          content: [{ type: "text", text: outputJson({ ...safe, fixtures }) }],
        };
      });
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const send = transport.send.bind(transport);
      transport.send = (message, options) => {
        if ("result" in message)
          return send({ ...message, result: { ...message.result, fixtures } }, options);
        if ("error" in message)
          return send(
            {
              ...message,
              error: {
                code: message.error.code,
                message: "The MCP request could not be completed.",
                data: { fixtures },
              },
            },
            options,
          );
        return send(message, options);
      };
      transport.onerror = () => log(`tally-http method=${method} tool=${tool} status=error`);
      res.setHeader("Cache-Control", "no-store");
      if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    };
    void (async () => {
      try {
        await Promise.race([work(), timeout]);
      } catch (error) {
        const mapped = plainError(error);
        fail(
          mapped.kind === "timeout"
            ? 504
            : mapped.kind === "body_too_large"
              ? 413
              : mapped.kind === "invalid_request"
                ? 400
                : 503,
          mapped.kind,
          mapped.message,
        );
      } finally {
        clearTimeout(timer!);
        abort.abort();
        if (server)
          await server
            .close()
            .catch(() => log(`tally-http method=${method} tool=${tool} status=cleanup_error`));
        else if (transport)
          await transport
            .close()
            .catch(() => log(`tally-http method=${method} tool=${tool} status=cleanup_error`));
        // Timeout cannot cancel engine I/O. Keep its slot until it settles; otherwise retries could grow unbounded.
        if (running) {
          const release = () => {
            active--;
          };
          void running.then(release, release);
        } else active--;
      }
    })();
  });
  http.requestTimeout = TIMEOUT_MS;
  http.headersTimeout = TIMEOUT_MS;
  http.keepAliveTimeout = 1000;
  return http;
}

export async function startHttpServer(options: HttpOptions = {}) {
  const env = unsignedEnv(options.env ?? process.env);
  const port = integer(env.TALLY_MCP_HTTP_PORT, 3300, 0, 65535);
  const server = createHttpServer({ ...options, env });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}
