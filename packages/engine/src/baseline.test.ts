import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  JUMP_LIMIT_PPM,
  Registry,
  checkOndoMultiplier,
  parseDecimal,
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

describe("the bounds against real data: seed (2026-09-30) as baseline, public Ondo list of 2026-10-02 as the reading", () => {
  const list = (dir: string) =>
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
  const now = list("snapshot-2026-10-02");

  it("accepts every one of the 458 tokens: unchanged, or one small step up (research/ondo-multiplier-steps.md)", () => {
    expect(now.size).toBe(458);
    for (const [addr, r] of now) {
      const res = checkOndoMultiplier({
        current: parseDecimal(r.multiplier, 18),
        previous: store.get(addr),
      });
      expect(res.outcome, `${r.symbol}: ${res.detail}`).toBe("pass");
    }
  });
  it("31 tokens changed, none decreased, the largest step is +0.58% (USHY), and the 3% limit is about five times that", () => {
    let changed = 0;
    let decreased = 0;
    let max = 0;
    let maxSymbol = "";
    for (const [addr, r] of now) {
      const base = store.get(addr)!.value;
      const cur = parseDecimal(r.multiplier, 18);
      if (cur === base) continue;
      changed++;
      if (cur < base) decreased++;
      const step = Number(((cur - base) * 1_000_000n) / base);
      if (step > max) [max, maxSymbol] = [step, r.symbol];
    }
    expect({ changed, decreased, maxSymbol }).toEqual({
      changed: 31,
      decreased: 0,
      maxSymbol: "USHYon",
    });
    expect(max / 10_000).toBeCloseTo(0.579, 3);
    expect(JUMP_LIMIT_PPM / max).toBeGreaterThan(5);
  });
  it("a per-day yield cap would have rejected the distribution steps: HYG stepped +0.40% where 5.8% ÷ 365 allows 0.016%", () => {
    const hyg = [...now.values()].find((r) => r.symbol === "HYGon")!;
    const base = store.get([...now.keys()].find((k) => now.get(k) === hyg)!)!.value;
    const step = Number(((parseDecimal(hyg.multiplier, 18) - base) * 1_000_000n) / base) / 10_000; // percent
    expect(step).toBeCloseTo(0.4, 1);
    expect(step).toBeGreaterThan((5.8 / 365) * 10);
  });
  it("SOXS shows reverse splits happen (0.1017): the same rule blocks a drop to it from 1.017 without a stock_split, and accepts it with one", () => {
    const soxs = [...now.values()].find((r) => r.symbol === "SOXSon")!;
    expect(Number(soxs.multiplier)).toBeCloseTo(0.1017, 3);
    const old = { value: parseDecimal("1.0170", 18), at: Date.parse("2026-09-30T19:35:13Z") };
    const cur = parseDecimal(soxs.multiplier, 18);
    expect(checkOndoMultiplier({ current: cur, previous: old }).outcome).toBe("fail");
    expect(
      checkOndoMultiplier({ current: cur, previous: old, reasonMsg: "stock_split 1-for-10" })
        .outcome,
    ).toBe("pass");
  });
});
