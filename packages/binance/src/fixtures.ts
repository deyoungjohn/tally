/* eslint-disable @typescript-eslint/no-explicit-any -- fixture JSON is untyped by nature */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A fetch() that answers from recorded fixtures, so the real client, schemas and error mapping run offline.
 *  - authenticated calls: fixtures/raw/*  (recorded on the Seoul EC2, 2026-10-02)
 *  - public calls:        research/snapshot-2026-09-30/*  (recorded 2026-09-30)
 * Anything not recorded answers with a clear 40001 telling you which recorder to run.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
export const RAW_DIR = join(HERE, "..", "fixtures", "raw");
export const SNAPSHOT_DIR = join(HERE, "..", "..", "..", "research", "snapshot-2026-09-30");

export function latestRaw(prefix: string, dir = RAW_DIR): string {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort();
  const f = files.at(-1);
  if (!f) throw new Error(`no fixture starting with ${prefix} in ${dir}`);
  return join(dir, f);
}
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8")) as any;

export interface FixtureFetchOptions {
  rawDir?: string;
  snapshotDir?: string;
  /** Answer every authenticated call the way a blocked caller IP gets it: 40304 as HTTP 200. */
  blockRegion?: boolean;
}

const ok = (data: unknown) => ({ code: 0, msg: "success", data, timestamp: 0, success: true });
const fail = (code: number, msg: string) => ({
  code,
  msg,
  data: null,
  timestamp: 0,
  success: false,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function createFixtureFetch(o: FixtureFetchOptions = {}): typeof fetch {
  const raw = o.rawDir ?? RAW_DIR;
  const snap = o.snapshotDir ?? SNAPSHOT_DIR;
  const ladder: any[] = readJson(latestRaw("quote_ladder", raw));
  const bnb = readJson(latestRaw("quote_bnb_price", raw));
  const swaps = readJson(latestRaw("swap_build", raw));
  const health = readJson(latestRaw("health_supported_chain", raw));
  const probes = readJson(latestRaw("rwa_authenticated_probes", raw));
  const block = readJson(latestRaw("region_block_US", raw)).body;
  const probes2 = readJson(latestRaw("probes_", raw));
  const lists = {
    1: readJson(join(snap, "rwa_list_ondo.json")),
    2: readJson(join(snap, "rwa_list_xstocks.json")),
    3: readJson(join(snap, "rwa_list_bstock.json")),
  } as Record<number, any>;
  const rwaTri = readJson(join(snap, "rwa_dynamic_tri.json"));
  const tokTri = readJson(join(snap, "token_dynamic_tri.json"));
  const issuerKey: Record<number, string> = { 1: "ondo", 2: "xstocks", 3: "bstock" };
  const tickerOf = new Map<string, { ticker: string; issuer: string }>();
  for (const t of [1, 2, 3])
    for (const r of lists[t].data)
      tickerOf.set(String(r.contractAddress).toLowerCase(), {
        ticker: r.ticker,
        issuer: issuerKey[t]!,
      });

  return async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url,
    );
    const q = url.searchParams;
    const addr = (q.get("toTokenAddress") ?? q.get("contractAddress") ?? "").toLowerCase();

    if (url.pathname.startsWith("/build/")) {
      if (o.blockRegion) return json(block);
      const path = url.pathname.slice("/build".length);
      if (path === "/api/v1/dex/aggregator/supported/chain") return json(ok(health.data));
      if (path === "/api/v1/dex/aggregator/quote") {
        const amount = q.get("amount");
        if (addr === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") return json(ok(bnb.data));
        const isOndo = tickerOf.get(addr)?.issuer === "ondo";
        if (isOndo && !q.get("userWalletAddress"))
          return json(fail(40001, "userWalletAddress is required for RFQ (Ondo) quote"));
        const hit = ladder.find(
          (e) =>
            e.response.ok &&
            e.response.data[0].toToken.tokenContractAddress.toLowerCase() === addr &&
            e.response.data[0].fromTokenAmount === amount,
        );
        if (hit) return json(ok(hit.response.data));
        // USDT is ~$0.9995, so the $5 minimum is refused up to ~5.0025 USDT (F4)
        if (isOndo && amount && BigInt(amount) < 5_003n * 10n ** 15n)
          return json(fail(40375, "Minimum order amount is 5 USD."));
        return json(
          fail(
            40001,
            `fixture: no recorded quote for ${addr} amount ${amount}. Recorded: NVDA, AAPL, NFLX at 6, 25, 100, 1000 USDT. Run spike/record_m1_fixtures.py on the Seoul EC2.`,
          ),
        );
      }
      if (path === "/api/v1/dex/aggregator/swap") {
        const s = Object.values<any>(swaps).find(
          (e) => e.swap?.ok && e.swap.params.toTokenAddress.toLowerCase() === addr,
        );
        return s
          ? json(ok(s.swap.data))
          : json(fail(40001, `fixture: no recorded swap for ${addr}`));
      }
      // Recorded for NVDAon and NVDAB only (spike/record_m1_probes.py); other tokens answer like an unrecorded call.
      const probeFor = (key: string) =>
        Object.entries<any>(probes2).find(
          ([k, v]) =>
            k.startsWith(key) &&
            v.ok &&
            String(v.params?.tokenContractAddress).toLowerCase() ===
              (q.get("tokenContractAddress") ?? "").toLowerCase(),
        )?.[1];
      if (
        path === "/api/v1/dex/market/rwa/underlying-profile" ||
        path === "/api/v1/dex/market/rwa/underlying-market"
      ) {
        const hit = probeFor(
          path.endsWith("profile") ? "rwa_underlying_profile" : "rwa_underlying_market",
        );
        return hit
          ? json(ok(hit.data))
          : json(fail(40001, `fixture: ${path} not recorded for ${q.get("tokenContractAddress")}`));
      }
      if (path === "/api/v1/dex/pre-transaction/simulate")
        return json(ok(probes2.tx_simulate_a.data));
      if (path === "/api/v1/dex/pre-transaction/gas-price")
        return json(ok(probes2.tx_gas_price.data));
      if (path === "/api/v1/dex/market/rwa/tokens") return json(ok(probes.rwa_tokens.data));
      if (path === "/api/v1/dex/market/rwa/search") return json(ok(probes.rwa_search.data));
      if (path === "/api/v1/dex/market/rwa/platforms") return json(ok(probes.rwa_platforms.data));
      return json(fail(40001, `fixture: ${path} was not recorded`));
    }

    // Public bapi
    const list = /stock\/detail\/list\/ai/.exec(url.pathname) ? Number(q.get("type")) : 0;
    if (list) return json(lists[list] ?? fail(40001, "unknown list type"));
    const meta = tickerOf.get(String(q.get("contractAddress") ?? "").toLowerCase());
    const pick = (tri: any) => (meta ? tri[meta.ticker]?.[meta.issuer] : undefined);
    if (/rwa\/dynamic\/ai/.test(url.pathname))
      return json(pick(rwaTri) ?? { code: "100001", data: null });
    if (/token\/dynamic\/info\/ai/.test(url.pathname))
      return json(pick(tokTri) ?? { code: "100001", data: null });
    return json({ code: "404", data: null }, 404);
  };
}
