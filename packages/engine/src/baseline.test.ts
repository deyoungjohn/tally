import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  JUMP_LIMIT_PPM,
  Registry,
  checkOndoMultiplier,
  matchSimpleRatio,
  parseDecimal,
  statusFromInfo,
  validateMultiplierAgainstPrice,
  type RegistryToken,
} from "@tally/core";
import { JsonBaselineStore, SEED_PATH, baselineFromEnv } from "./baseline";

const RESEARCH = join(SEED_PATH, "..", "..", "research");

const NVDAON = "0xa9ee28c80f960b889dfbd1902055218cba016f75";
const token = Registry.fromRows([
  { ticker: "NVDA", issuer: "ondo", address: NVDAON, symbol: "NVDAon", decimals: 18, assetType: 1 },
]).tokensFor("NVDA")[0] as RegistryToken;
const m = (s: string) => parseDecimal(s, 18);
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "tally-baseline-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("committed seed: data/ondo-multiplier-baseline.json", () => {
  const seed = JSON.parse(readFileSync(SEED_PATH, "utf8"));
  it("has one entry per Ondo BSC token from the 2026-09-30 snapshot (458), each with a value and seenAt", () => {
    expect(seed.schema).toBe(1);
    expect(Object.keys(seed.entries)).toHaveLength(458);
    for (const [addr, e] of Object.entries<{ symbol: string; value: string; seenAt: string }>(
      seed.entries,
    )) {
      expect(addr).toMatch(/^0x[0-9a-f]{40}$/);
      expect(parseDecimal(e.value, 18)).toBeGreaterThan(0n);
      expect(e.seenAt).toBe("2026-09-30T19:35:13Z");
    }
  });
  it("matches the unit-trap tokens of F1: NFLXon 10, SOXS ≠ 1, and 242 of 458 differ from 1", () => {
    const vals = Object.values<{ symbol: string; value: string }>(seed.entries);
    expect(vals.find((v) => v.symbol === "NFLXon")!.value).toBe("10");
    expect(vals.filter((v) => v.value !== "1")).toHaveLength(242);
  });
  it("reads NVDAon as 1.0017152487959898 seen 2026-09-30", () => {
    const s = new JsonBaselineStore();
    expect(s.size).toBe(458);
    expect(s.get(NVDAON.toUpperCase().replace("0X", "0x"))).toEqual({
      value: m("1.0017152487959898"),
      at: Date.parse("2026-09-30T19:35:13Z"),
    });
    expect(s.get("0x0000000000000000000000000000000000000001")).toBeUndefined();
  });
});

describe("JsonBaselineStore", () => {
  it("is read-only without a path: record() never writes, and never touches the repo seed", async () => {
    const before = readFileSync(SEED_PATH, "utf8");
    const s = new JsonBaselineStore();
    expect(s.writable).toBe(false);
    await s.record(token, m("1.5"), Date.now());
    expect(s.get(NVDAON)!.value).toBe(m("1.0017152487959898"));
    expect(readFileSync(SEED_PATH, "utf8")).toBe(before);
  });
  it("first run creates the runtime copy from the seed; later runs read the runtime copy", async () => {
    const path = join(tmp(), "data", "baseline.json");
    expect(existsSync(path)).toBe(false);
    const s = new JsonBaselineStore({ path });
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8")).entries[NVDAON].value).toBe("1.0017152487959898");
    await s.record(token, m("1.0167"), Date.parse("2026-10-05T00:00:00Z"));
    const again = new JsonBaselineStore({ path });
    expect(again.get(NVDAON)).toEqual({
      value: m("1.0167"),
      at: Date.parse("2026-10-05T00:00:00Z"),
    });
  });
  it("writes the value at full precision with an ISO seenAt, atomically (no temp files left behind)", async () => {
    const dir = tmp();
    const path = join(dir, "b.json");
    const s = new JsonBaselineStore({ path });
    await s.record(token, m("1.123456789012345678"), Date.parse("2026-10-06T12:30:00Z"));
    expect(JSON.parse(readFileSync(path, "utf8")).entries[NVDAON]).toEqual({
      symbol: "NVDAon",
      value: "1.123456789012345678",
      seenAt: "2026-10-06T12:30:00.000Z",
    });
    expect(readdirSync(dir)).toEqual(["b.json"]);
  });
  it("skips the write when the value is unchanged and was seen within 24 h; refreshes seenAt after that", async () => {
    const path = join(tmp(), "b.json");
    const s = new JsonBaselineStore({ path });
    const t0 = Date.parse("2026-10-06T00:00:00Z");
    await s.record(token, m("1.0017152487959898"), t0); // same value as the seed, but the seed is 5 days old: refresh
    expect(s.get(NVDAON)!.at).toBe(t0);
    const mtimeText = readFileSync(path, "utf8");
    await s.record(token, m("1.0017152487959898"), t0 + 3_600_000); // 1 h later: no write
    expect(readFileSync(path, "utf8")).toBe(mtimeText);
    await s.record(token, m("1.0017152487959898"), t0 + 25 * 3_600_000); // 25 h later: refresh
    expect(s.get(NVDAON)!.at).toBe(t0 + 25 * 3_600_000);
  });
  it("rejects an unknown schema instead of guessing", () => {
    const path = join(tmp(), "bad.json");
    writeFileSync(path, JSON.stringify({ schema: 2, source: "x", entries: {} }));
    expect(() => new JsonBaselineStore({ seedPath: path })).toThrow(/unsupported baseline schema/);
  });
  it("baselineFromEnv: read-only with a warning unless TALLY_DATA_DIR or TALLY_BASELINE_PATH is set", () => {
    const warned: string[] = [];
    expect(baselineFromEnv({}, (m) => warned.push(m)).writable).toBe(false);
    expect(warned.join()).toMatch(/TALLY_DATA_DIR/);
    const dir = tmp();
    expect(baselineFromEnv({ TALLY_DATA_DIR: dir }).writable).toBe(true);
    expect(existsSync(join(dir, "ondo-multiplier-baseline.json"))).toBe(true);
    expect(baselineFromEnv({ TALLY_BASELINE_PATH: join(dir, "x.json") }).writable).toBe(true);
  });
});

describe("corporate-action sightings are remembered across runs", () => {
  const H = 3_600_000;
  const T0 = Date.parse("2026-10-06T00:00:00Z");
  const open = (path: string) => new JsonBaselineStore({ path });
  it("noteAction stores the sighting, and a new process reads it back", async () => {
    const path = join(tmp(), "b.json");
    await open(path).noteAction(token, "stock_split", T0);
    expect(open(path).getAction(NVDAON)).toEqual({
      kind: "stock_split",
      firstSeenAt: T0,
      lastSeenAt: T0,
    });
    expect(open(path).getAction("0x0000000000000000000000000000000000000001")).toBeUndefined();
  });
  it("a halt polled every minute is ONE sighting: writes at most hourly, first-seen kept, last-seen extended", async () => {
    const path = join(tmp(), "b.json");
    const s = open(path);
    await s.noteAction(token, "stock_split", T0);
    await s.noteAction(token, "stock_split", T0 + 60_000); // 1 min later: no write
    expect(s.getAction(NVDAON)!.lastSeenAt).toBe(T0);
    await s.noteAction(token, "stock_split", T0 + 2 * H);
    expect(s.getAction(NVDAON)).toEqual({
      kind: "stock_split",
      firstSeenAt: T0,
      lastSeenAt: T0 + 2 * H,
    });
  });
  it("a later sighting after 7 days, or of another kind, starts a new one", async () => {
    const path = join(tmp(), "b.json");
    const s = open(path);
    await s.noteAction(token, "stock_split", T0);
    await s.noteAction(token, "stock_dividend", T0 + 2 * H);
    expect(s.getAction(NVDAON)).toEqual({
      kind: "stock_dividend",
      firstSeenAt: T0 + 2 * H,
      lastSeenAt: T0 + 2 * H,
    });
    await s.noteAction(token, "stock_dividend", T0 + 9 * 24 * H);
    expect(s.getAction(NVDAON)!.firstSeenAt).toBe(T0 + 9 * 24 * H);
  });
  it("an accepted CHANGE consumes the sighting; a refresh of an unchanged value keeps it", async () => {
    const path = join(tmp(), "b.json");
    const s = open(path);
    await s.noteAction(token, "stock_split", T0);
    await s.record(token, m("1.0017152487959898"), T0 + 30 * H); // same value as the seed, only refreshing seenAt
    expect(s.getAction(NVDAON)).toBeDefined();
    await s.record(token, m("10.017"), T0 + 31 * H); // the split lands
    expect(s.getAction(NVDAON)).toBeUndefined();
    expect(s.get(NVDAON)!.value).toBe(m("10.017"));
  });
  it("read-only stores and tokens with no baseline entry never write", async () => {
    const ro = new JsonBaselineStore();
    await ro.noteAction(token, "stock_split", T0);
    expect(ro.getAction(NVDAON)).toBeUndefined();
    const stranger = Registry.fromRows([
      {
        ticker: "ZZZ",
        issuer: "ondo",
        address: "0x00000000000000000000000000000000000000aa",
        symbol: "ZZZon",
        decimals: 18,
        assetType: 1,
      },
    ]).tokensFor("ZZZ")[0]!;
    const s = open(join(tmp(), "b.json"));
    await s.noteAction(stranger, "stock_split", T0);
    expect(s.getAction(stranger.address)).toBeUndefined();
  });
});

describe("the bounds against real data: seed (2026-09-30) as baseline, public Ondo list of 2026-10-02 as the reading", () => {
  const readList = (dir: string) =>
    new Map(
      (
        JSON.parse(readFileSync(join(RESEARCH, dir, "rwa_list_ondo.json"), "utf8")).data as Array<{
          chainId: string;
          contractAddress: string;
          symbol: string;
          multiplier: string;
        }>
      )
        .filter((r) => r.chainId === "56")
        .map((r) => [r.contractAddress.toLowerCase(), r]),
    );
  const store = new JsonBaselineStore();
  const now = readList("snapshot-2026-10-02");
  const open = statusFromInfo({ openState: true, marketStatus: "regular", reasonCode: "TRADING" });
  const NOW = Date.parse("2026-10-02T12:00:00Z");
  const check = (
    addr: string,
    current: string,
    extra: Partial<Parameters<typeof checkOndoMultiplier>[0]> = {},
  ) =>
    checkOndoMultiplier({
      now: NOW,
      status: open,
      current: parseDecimal(current, 18),
      previous: store.get(addr),
      ...extra,
    });
  const steps = [...now.entries()].filter(
    ([addr, r]) => store.get(addr)!.value !== parseDecimal(r.multiplier, 18),
  );

  it("accepts all 458 tokens: unchanged, or one small step up (research/ondo-multiplier-steps.md)", () => {
    expect(now.size).toBe(458);
    for (const [addr, r] of now) {
      const res = check(addr, r.multiplier);
      expect(res.outcome, `${r.symbol}: ${res.detail}`).toBe("pass");
    }
  });
  it("31 tokens changed, none decreased, the largest step is +0.58% (USHY), and the 3% limit is about five times that", () => {
    let decreased = 0;
    let max = 0;
    let maxSymbol = "";
    for (const [addr, r] of steps) {
      const base = store.get(addr)!.value;
      const cur = parseDecimal(r.multiplier, 18);
      if (cur < base) decreased++;
      const step = Number(((cur - base) * 1_000_000n) / base);
      if (step > max) [max, maxSymbol] = [step, r.symbol];
    }
    expect({ changed: steps.length, decreased, maxSymbol }).toEqual({
      changed: 31,
      decreased: 0,
      maxSymbol: "USHYon",
    });
    expect(max / 10_000).toBeCloseTo(0.579, 3);
    expect(JUMP_LIMIT_PPM / max).toBeGreaterThan(5);
  });
  it("none of the 31 dividend steps looks like a split (no simple ratio), so none needs the three-part rule", () => {
    for (const [addr, r] of steps)
      expect(
        matchSimpleRatio(parseDecimal(r.multiplier, 18), store.get(addr)!.value),
        r.symbol,
      ).toBeUndefined();
  });
  it("each of the 31 steps is accepted on size, with the price check 'unavailable' (the repo has no 10-02 prices); the 427 unchanged need none", () => {
    for (const [addr, r] of steps)
      expect(check(addr, r.multiplier).validation.outcome, r.symbol).toBe("unavailable");
    const unchanged = [...now.entries()].filter(
      ([addr, r]) => store.get(addr)!.value === parseDecimal(r.multiplier, 18),
    );
    expect(unchanged).toHaveLength(427);
    expect(check(unchanged[0]![0], unchanged[0]![1].multiplier).validation.outcome).toBe(
      "not-needed",
    );
  });
  it("the price check applies to a dividend step too: HYG's +0.40% step is accepted with a matching price and blocked with one 5% off", () => {
    const [addr, hyg] = steps.find(([, r]) => r.symbol === "HYGon")!;
    const stock = 77.1;
    const tokenPrice = stock * Number(hyg.multiplier);
    const ok = check(addr, hyg.multiplier, { prices: { stockPrice: stock, tokenPrice } });
    expect(ok.outcome).toBe("pass");
    expect(ok.validation).toMatchObject({
      outcome: "pass",
      inputs: { multiplier: expect.stringMatching(/^1\.06/), stockPrice: stock },
    });
    const bad = check(addr, hyg.multiplier, {
      prices: { stockPrice: stock, tokenPrice: tokenPrice * 1.05 },
    });
    expect(bad.outcome).toBe("fail");
    expect(bad.detail).toMatch(/FAILED the price check/);
  });

  describe("check 3 on real prices (public RWA dynamic data of 2026-09-30, a regular session)", () => {
    const read = (f: string) =>
      JSON.parse(readFileSync(join(RESEARCH, "snapshot-2026-09-30", f), "utf8"));
    const priced = (d: {
      data?: {
        tokenInfo?: { price?: string; sharesMultiplier?: string };
        stockInfo?: { price?: string };
      };
    }) => ({
      mult: parseDecimal(d.data!.tokenInfo!.sharesMultiplier!, 18),
      tokenPrice: Number(d.data!.tokenInfo!.price),
      stockPrice: Number(d.data!.stockInfo!.price),
    });
    it("NFLXon (10.0) and CRWDon (4.0) validate: token price ÷ multiplier is within 0.1% of the US price", () => {
      const tri = read("rwa_dynamic_tri.json");
      for (const [ticker, mult] of [
        ["NFLX", "10"],
        ["CRWD", "4"],
      ] as const) {
        const p = priced(tri[ticker].ondo);
        expect(p.mult).toBe(parseDecimal(mult, 18));
        const v = validateMultiplierAgainstPrice({
          multiplier: p.mult,
          tokenPrice: p.tokenPrice,
          stockPrice: p.stockPrice,
          status: open,
        });
        expect(v.outcome, `${ticker}: ${v.summary}`).toBe("pass");
        expect(Math.abs(v.inputs.deviationPct!)).toBeLessThan(0.1);
      }
    });
    it("and both splits are accepted as a 10-for-1 / 4-for-1 from a baseline of 1, given the status sighting", () => {
      const tri = read("rwa_dynamic_tri.json");
      for (const [ticker, mult] of [
        ["NFLX", "10"],
        ["CRWD", "4"],
      ] as const) {
        const p = priced(tri[ticker].ondo);
        const r = checkOndoMultiplier({
          now: NOW,
          status: open,
          current: parseDecimal(mult, 18),
          previous: { value: parseDecimal("1", 18), at: 0 },
          action: { kind: "stock_split", firstSeenAt: NOW - 3_600_000, lastSeenAt: NOW },
          prices: p,
        });
        expect(r.outcome, r.detail).toBe("pass");
      }
    });
    it("the xStocks NFLX token (multiplier 10, token $71.30) FAILS the check: the multiplier disagreement it was flagged for in F1", () => {
      const p = priced(read("rwa_dynamic_tri.json").NFLX.xstocks);
      const v = validateMultiplierAgainstPrice({
        multiplier: p.mult,
        tokenPrice: p.tokenPrice,
        stockPrice: p.stockPrice,
        status: open,
      });
      expect(v.outcome).toBe("fail");
      expect(v.inputs.deviationPct).toBeCloseTo(-89.8, 1);
    });
    it("all 28 priced Ondo tokens of the dividend set validate, each within 0.15% (the check is not noisy on real data)", () => {
      const set = read("rwa_dynamic_ondo_dividend_set.json") as Record<
        string,
        {
          data?: {
            tokenInfo?: { price?: string; sharesMultiplier?: string };
            stockInfo?: { price?: string };
          };
        }
      >;
      let n = 0;
      for (const [ticker, d] of Object.entries(set)) {
        if (!d.data?.tokenInfo?.price || !d.data?.stockInfo?.price) continue;
        const p = priced(d);
        const v = validateMultiplierAgainstPrice({
          multiplier: p.mult,
          tokenPrice: p.tokenPrice,
          stockPrice: p.stockPrice,
          status: open,
        });
        expect(v.outcome, `${ticker}: ${v.summary}`).toBe("pass");
        expect(Math.abs(v.inputs.deviationPct!), ticker).toBeLessThan(0.15);
        n++;
      }
      expect(n).toBe(28);
    });
  });

  it("SOXS (0.1017) shows reverse splits happen: from 1.017 it is blocked on its own, and accepted with the status sighting, a 1/10 ratio and a matching price", () => {
    const [addr, soxs] = [...now.entries()].find(([, r]) => r.symbol === "SOXSon")!;
    expect(Number(soxs.multiplier)).toBeCloseTo(0.1017, 3);
    const old = {
      previous: { value: parseDecimal("1.0170", 18), at: Date.parse("2026-09-30T19:35:13Z") },
    };
    const px = { stockPrice: 30, tokenPrice: 30 * Number(soxs.multiplier) }; // SOXS has no price data in the repo: stated assumption
    expect(check(addr, soxs.multiplier, old).outcome).toBe("fail");
    const ok = check(addr, soxs.multiplier, {
      ...old,
      prices: px,
      action: { kind: "stock_split", firstSeenAt: NOW - 7_200_000, lastSeenAt: NOW },
    });
    expect(ok.outcome).toBe("pass");
    expect(ok.detail).toMatch(/simple ratio 1\/10/);
  });
});
