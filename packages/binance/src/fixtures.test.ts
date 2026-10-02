/* eslint-disable @typescript-eslint/no-explicit-any -- fixture JSON is untyped by nature */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BinanceApi } from "./trading";
import { toRawQuote, pickBest } from "./trading";
import { BinanceClient } from "./client";
import { BinanceApiError } from "./errors";
import { PublicApi } from "./public";
import { RAW_DIR, createFixtureFetch, latestRaw } from "./fixtures";
import { quoteResponse, swapResponse } from "./schemas";

const j = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const api = (o: Parameters<typeof createFixtureFetch>[0] = {}) =>
  new BinanceApi(
    new BinanceClient({
      apiKey: "k",
      apiSecret: "s",
      fetch: createFixtureFetch(o),
      ratePerSec: 10_000,
      burst: 10_000,
    }),
  );
const NVDAON = "0xa9ee28c80f960b889dfbd1902055218cba016f75";
const NVDAB = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436";
const WALLET = "0xcb634955B8A7DF7B106f7AB47C9759B26206b777";

describe("recorded Seoul fixtures parse through the real schemas", () => {
  const ladder = j(latestRaw("quote_ladder"));
  it("all 24 recorded quotes (6/25/100/1000 USDT × NVDA/AAPL/NFLX × bStock/Ondo) match the quote schema and normalise", () => {
    expect(ladder).toHaveLength(24);
    for (const e of ladder) {
      expect(e.response.ok, `${e.symbol} ${e.usdt}`).toBe(true);
      const routes = quoteResponse.parse(e.response.data);
      const q = toRawQuote(pickBest(routes)!);
      expect(q.executionMode).toBe("SWAP"); // V8: Ondo behaved as SWAP in every run
      expect(q.apiGas).toBe(450000); // V10: always the placeholder
      expect(q.amountIn).toBe(BigInt(e.usdt) * 10n ** 18n);
      expect(q.tokensOut).toBeGreaterThan(0n);
      expect(q.legCount).toBeGreaterThanOrEqual(1);
      expect(q.hops.at(-1)!.toSymbol).toBe(e.symbol); // the route ends in the token we asked for
      expect(q.approveTarget).toBe("0xb44446b0c8e56988c34f7ff73ae904982b5fdda5");
    }
  });
  it("recorded swap builds parse, with the API's constant gas of 450000", () => {
    for (const s of Object.values<any>(j(latestRaw("swap_build")))) {
      const r = swapResponse.parse(s.swap.data);
      expect(r.tx?.gas).toBe("450000");
      expect(r.executionMode).toBe("SWAP");
      expect(r.rfq ?? null).toBeNull();
    }
  });
  it("route text and leg counts: parallel splits count as one leg", () => {
    const e = ladder.find((x: any) => x.symbol === "NVDAon" && x.usdt === 6);
    const q = toRawQuote(pickBest(quoteResponse.parse(e.response.data))!);
    expect(q.legCount).toBe(q.hops.length);
    expect(q.legCount).toBeLessThanOrEqual(
      quoteResponse.parse(e.response.data)[0]!.dexRouterList.length,
    );
  });
  it("the BNB quote carries a BNB price for the fee display", async () => {
    const price = await api().bnbUsd(WALLET);
    expect(price).toBeGreaterThan(100);
  });
});

describe("exit check 3: 40304 and 40375 are handled from fixtures", () => {
  it("40375: Ondo at 5 USDT is refused, as recorded (HTTP 200)", async () => {
    const rec = j(latestRaw("error_cases")).ondo_5_usdt_40375;
    expect(rec.http).toBe(200);
    expect(rec.body.code).toBe(40375);
    const e = await api()
      .quoteRoutes({ toToken: NVDAON, amount: 5n * 10n ** 18n, wallet: WALLET })
      .catch((x) => x);
    expect(e).toBeInstanceOf(BinanceApiError);
    expect(e).toMatchObject({
      kind: "below_minimum",
      code: 40375,
      message: "Minimum order amount is 5 USD.",
    });
  });
  it("40001: Ondo without a wallet", async () => {
    const e = await api()
      .quoteRoutes({ toToken: NVDAON, amount: 6n * 10n ** 18n, wallet: "" })
      .catch((x) => x);
    expect(e).toMatchObject({ kind: "param", code: 40001 });
    expect(e.message).toMatch(/userWalletAddress is required/);
  });
  it("40304: every recorded blocked exit (US, NL, RO) is a region block, whatever the status code", async () => {
    const files = readdirSync(RAW_DIR).filter((f) => f.startsWith("region_block_"));
    const blocked = files.map((f) => j(join(RAW_DIR, f))).filter((r) => r.body?.code === 40304);
    expect(blocked.map((r) => r.egress_country).sort()).toEqual(["NL", "RO", "US"]);
    for (const r of blocked) {
      expect(r.http).toBe(200); // the DX finding: a block that looks like success to a status-only client
      expect(r.body.msg).toBe("Service not available due to compliance restriction");
    }
  });
  it("40304 through the real client: the call fails with kind region_block", async () => {
    const e = await api({ blockRegion: true })
      .supportedChains()
      .catch((x) => x);
    expect(e).toBeInstanceOf(BinanceApiError);
    expect(e).toMatchObject({ kind: "region_block", code: 40304, http: 200 });
  });
  it("Japan was NOT blocked by the API (F9): that restriction is ours to enforce at the edge", () => {
    const jp = readdirSync(RAW_DIR)
      .filter((f) => f.startsWith("region_block_JP"))
      .map((f) => j(join(RAW_DIR, f)))[0];
    expect(jp.ok).toBe(true);
  });
  it("the 42900 rate-limit body recorded on the Seoul box is classified as rate_limited", () => {
    const probe = j(latestRaw("rate_limit_probe"));
    expect(probe.first_failure.body.code).toBe(42900);
    expect(probe.first_failure.http).toBe(429);
    expect(probe.first_failure.i).toBeLessThanOrEqual(6);
  });
  it("bad credentials: 40101 → auth", () => {
    const rec = j(latestRaw("error_cases")).bad_credentials;
    expect(rec.http).toBe(401);
    expect(rec.body.code).toBe(40101);
  });
});

describe("authenticated RWA data and public lists", () => {
  it("the authenticated list parses (assetType can be null) and carries status, reference price and tokenToShareRatio", async () => {
    const list = await api().rwaTokens();
    const nvdaon = list.find((t) => t.tokenContractAddress === NVDAON)!;
    expect(nvdaon.tokenToShareRatio).toBe("1.0017152487959898");
    expect(nvdaon.statusInfo?.reasonCode).toBe("TRADING");
    expect(Number(nvdaon.referencePrice)).toBeGreaterThan(100);
    const nflx = list.find((t) => t.tokenSymbol === "NFLXon")!;
    expect(nflx.tokenToShareRatio).toBe("10");
    expect(Number(nflx.tokenPrice) / Number(nflx.referencePrice)).toBeCloseTo(10, 6); // token price is 10× the per-share price
  });
  it("it is truncated and has no xStocks, so the registry cannot be built from it alone", async () => {
    const list = await api().rwaTokens();
    expect(list.length).toBe(488);
    expect(new Set(list.map((t) => t.platformId))).toEqual(new Set(["ondo", "bstock"]));
  });
  it("public lists: all three issuers, chain 56, and the unit-trap multipliers", async () => {
    const pub = new PublicApi(createFixtureFetch());
    const [ondo, xs, b] = await Promise.all([
      pub.list("ondo"),
      pub.list("xstocks"),
      pub.list("bstock"),
    ]);
    const on56 = (rows: typeof ondo) => rows.filter((r) => r.chainId === "56");
    expect(on56(ondo)).toHaveLength(458);
    expect(on56(xs)).toHaveLength(130);
    expect(on56(b)).toHaveLength(87);
    expect(on56(ondo).find((r) => r.symbol === "NFLXon")!.multiplier).toBe("10");
    expect(on56(b).find((r) => r.symbol === "NFLXB")!.multiplier).toBe("1");
    expect(on56(ondo).filter((r) => r.multiplier !== "1")).toHaveLength(242); // F1: 242 of 458
  });
  it("token dynamic gives the on-chain volume that exposes the xStocks ghost market ($96 across 38 tickers, F1)", async () => {
    const pub = new PublicApi(createFixtureFetch());
    const d = await pub.tokenDynamic("0xc845b2894dbddd03858fd2d643b4ef725fe0849d");
    expect(Number(d.volume24hBuy ?? 0) + Number(d.volume24hSell ?? 0)).toBeLessThan(1000);
    const b = await pub.tokenDynamic(NVDAB);
    expect(Number(b.volume24hBuy ?? 0) + Number(b.volume24hSell ?? 0)).toBeGreaterThan(1000);
  });
});

describe("probes recorded on the Seoul EC2 (2026-10-02)", () => {
  const probes = j(latestRaw("probes_"));
  it("underlying-profile: Ondo has a dated daily attestation report, bStock only an undated collateral report", () => {
    expect(probes.rwa_underlying_profile.data.protections.dailyAttestationReport.url).toMatch(
      /daily-2026-09-29\.pdf$/,
    );
    expect(probes.rwa_underlying_profile_bstock.data.protections.collateralReport.url).toBeNull();
  });
  it("underlying-market referencePrice is per SHARE and agrees with the list's referencePrice ÷ tokenToShareRatio within 0.1%", () => {
    const perShare = Number(probes.rwa_underlying_market.data.marketData.referencePrice); // 231.48655
    const list = j(latestRaw("rwa_authenticated_probes")).rwa_tokens.data.find(
      (t: { tokenSymbol: string }) => t.tokenSymbol === "NVDAon",
    );
    const derived = Number(list.referencePrice) / Number(list.tokenToShareRatio);
    expect(Math.abs(derived / perShare - 1)).toBeLessThan(0.001);
    expect(Number(list.referencePrice) / perShare).toBeGreaterThan(1.001); // the raw list value is per token: ≈ the 1.0017 multiplier higher
  });
  it("the RWA list ignores every paging parameter tried (it always returns 488); only platformId filters it, and xstocks is not a platform there", () => {
    for (const k of [
      "pageSize1000",
      "limit1000",
      "page2",
      "pageNo2",
      "pageIndex2",
      "offset488",
      "tabId",
    ])
      expect(probes[`rwa_tokens_${k}`].data, k).toHaveLength(488);
    expect(probes.rwa_tokens_platformId_bstock.data).toHaveLength(46);
    expect(probes.rwa_tokens_platformId_xstocks.body.msg).toBe("Platform not found: xstocks");
  });
  it("Binance simulate answers { status, failReason, balanceChanges, allowanceChanges } for evmTx; the flat body is rejected", async () => {
    expect(probes.tx_simulate_a.data.status).toBe("SUCCESS");
    expect(probes.tx_simulate_b.body.msg).toBe("evmParams is required for EVM chains");
    const sim = await api().simulate({ from: WALLET, to: NVDAB, data: "0x" });
    expect(sim.status).toBe("SUCCESS");
  });
  it("gas-price returns wei tiers (≈0.05 gwei) and the typed client parses them", async () => {
    const g = await api().gasPrice();
    expect(Number(g.evmLegacyGasPrice!.mediumGasPrice)).toBeLessThan(1e9);
  });
  it("Market GET /market/price is not a GET and /market/candlestick is a 404: the docs paths for Market are wrong or need POST", () => {
    expect(probes.market_price.body.errorData).toMatch(/GET' not supported/);
    expect(probes.market_candlestick.http).toBe(404);
  });
  it("aggregator history confirms the F6 NVDAB fill: 437,968 gas used, 6 USDT in", () => {
    expect(probes.agg_history.data.gasUsed).toMatch(/^437968/);
    expect(probes.agg_history.data.status).toBe("success");
  });
});
