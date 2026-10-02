import { z } from "zod";
import { BinanceApiError, isSuccessCode, kindForCode } from "./errors";
import { API_PREFIX, isoTimestamp, sign } from "./signing";

export interface ClientOptions {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  recvWindowMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Sustained requests per second. Observed 2026-10-02: ~5 calls in the first 50 ms, then 42900. Default 4. */
  ratePerSec?: number;
  /** Requests allowed back to back before spacing kicks in. */
  burst?: number;
  /** Retries for network errors, 5xx and 42900. Never for other 4xxxx codes. */
  retries?: number;
  timeoutMs?: number;
}

const envelope = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    msg: z.string().nullish(),
    message: z.string().nullish(),
    data: z.unknown().optional(),
  })
  .passthrough();

/** Token bucket: `burst` immediate calls, then one every 1/rate seconds. */
class Limiter {
  private tokens: number;
  private last: number;
  constructor(
    private readonly rate: number,
    private readonly burst: number,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {
    this.tokens = burst;
    this.last = now();
  }
  async take(): Promise<void> {
    for (;;) {
      const t = this.now();
      this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.rate);
      this.last = t;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await this.sleep(Math.ceil(((1 - this.tokens) / this.rate) * 1000));
    }
  }
}

/** Signed client for the Binance Web3 API. Every response is judged by its JSON `code`, never by HTTP status alone (V6). */
export class BinanceClient {
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly limiter: Limiter;
  private readonly retries: number;

  constructor(private readonly o: ClientOptions) {
    this.base = o.baseUrl ?? "https://web3.binance.com";
    this.f = o.fetch ?? fetch;
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.limiter = new Limiter(o.ratePerSec ?? 4, o.burst ?? 3, this.now, this.sleep);
    this.retries = o.retries ?? 2;
  }

  get<S extends z.ZodTypeAny>(
    path: string,
    params: Record<string, string | number | undefined>,
    schema: S,
  ): Promise<z.infer<S>> {
    const query = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]): [string, string] => [k, String(v)]),
    ).toString();
    return this.request("GET", path, query, "", schema);
  }

  post<S extends z.ZodTypeAny>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
    return this.request("POST", path, "", JSON.stringify(body), schema);
  }

  private async request<S extends z.ZodTypeAny>(
    method: "GET" | "POST",
    path: string,
    query: string,
    body: string,
    schema: S,
  ): Promise<z.infer<S>> {
    let lastError: BinanceApiError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      // 300 ms, 600 ms for network errors and 5xx; 1 s, 2 s after a 42900 (the limit is per second, so a short wait fails again)
      if (attempt > 0)
        await this.sleep((lastError?.kind === "rate_limited" ? 1000 : 300) * 2 ** (attempt - 1));
      await this.limiter.take();
      try {
        return await this.once(method, path, query, body, schema);
      } catch (e) {
        if (!(e instanceof BinanceApiError)) throw e;
        lastError = e;
        const retryable =
          e.kind === "network" || e.kind === "upstream" || e.kind === "rate_limited";
        if (!retryable || attempt === this.retries) throw e;
      }
    }
    throw lastError!;
  }

  private async once<S extends z.ZodTypeAny>(
    method: "GET" | "POST",
    path: string,
    query: string,
    body: string,
    schema: S,
  ): Promise<z.infer<S>> {
    const timestamp = isoTimestamp(this.now());
    const headers: Record<string, string> = {
      "X-OC-APIKEY": this.o.apiKey,
      "X-OC-TIMESTAMP": timestamp,
      "X-OC-SIGN": sign({ secret: this.o.apiSecret, timestamp, method, path, query, body }),
      "X-OC-RECV-WINDOW": String(this.o.recvWindowMs ?? 10_000),
      Accept: "application/json",
    };
    if (body) headers["Content-Type"] = "application/json";
    const url = `${this.base}${API_PREFIX}${path}${query ? `?${query}` : ""}`;

    let res: Response;
    let text: string;
    try {
      res = await this.f(url, {
        method,
        headers,
        body: body || undefined,
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 30_000),
      });
      text = await res.text();
    } catch (e) {
      throw new BinanceApiError(
        "network",
        undefined,
        `network error: ${e instanceof Error ? e.message : String(e)}`,
        undefined,
        path,
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      const kind = res.status >= 500 ? "upstream" : "unknown";
      throw new BinanceApiError(
        kind,
        undefined,
        `non-JSON response (HTTP ${res.status}): ${text.slice(0, 120)}`,
        res.status,
        path,
      );
    }
    const env = envelope.safeParse(json);
    if (!env.success || env.data.code === undefined) {
      throw new BinanceApiError(
        "unknown",
        undefined,
        `unexpected response shape (HTTP ${res.status})`,
        res.status,
        path,
      );
    }
    const { code, msg, message, data } = env.data;
    // The check that matters: a 200 can carry an error code (40304, 40375, 40001...), and a 4xx carries one too.
    if (!isSuccessCode(code) || res.status >= 400) {
      const n = typeof code === "number" ? code : Number(code);
      const kind =
        Number.isFinite(n) && !isSuccessCode(code)
          ? kindForCode(n)
          : res.status >= 500
            ? "upstream"
            : "unknown";
      throw new BinanceApiError(
        kind,
        code,
        String(msg ?? message ?? `code ${code}`),
        res.status,
        path,
      );
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new BinanceApiError(
        "unknown",
        code,
        `response did not match the expected shape: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
        res.status,
        path,
      );
    }
    return parsed.data;
  }
}
