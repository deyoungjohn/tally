import { describe, expect, it } from "vitest";
import { expectedSwapGas, feeUsd, gasLimitFromEstimate } from "./gas";
import { TtlCache, amountBucket } from "./cache";
import { Registry } from "./registry";

describe("gas model (blueprint §7.4 step 7, F6)", () => {
  it("is calibrated to the real fills and grows with hops", () => {
    expect(expectedSwapGas(1)).toBe(440_000); // 437,968 measured
    expect(expectedSwapGas(2)).toBe(600_000);
    expect(expectedSwapGas(3)).toBe(780_000);
    expect(expectedSwapGas(4)).toBeGreaterThanOrEqual(775_639); // the 4-hop live fill used 775,639
    expect(expectedSwapGas(6)).toBeGreaterThan(expectedSwapGas(4));
    expect(expectedSwapGas(0)).toBe(440_000);
  });
  it("is never the API's 450000 for a long route (that value reverted on mainnet)", () => {
    expect(expectedSwapGas(4)).toBeGreaterThan(450_000);
  });
  it("fee in USD: gas × price × BNB (F6: ≈$0.02–0.03 at 0.05 gwei)", () => {
    const fee = feeUsd(440_000, 68_162_033n, 772.8);
    expect(fee).toBeGreaterThan(0.02);
    expect(fee).toBeLessThan(0.03);
  });
  it("limit = ceil(estimate × 1.25): estimateGas 942,344 → 1,177,930 (the limit the live fill sent)", () => {
    expect(gasLimitFromEstimate(942_344n)).toBe(1_177_930n);
    expect(gasLimitFromEstimate(1n)).toBe(2n);
  });
});

describe("TtlCache and amount buckets (blueprint §7.7)", () => {
  it("serves from cache until the TTL expires, then reloads", async () => {
    let t = 0;
    let loads = 0;
    const c = new TtlCache<number>(10_000, () => t);
    const load = async () => ++loads;
    expect(await c.get("k", load)).toBe(1);
    t = 9_999;
    expect(await c.get("k", load)).toBe(1);
    t = 10_000;
    expect(await c.get("k", load)).toBe(2);
  });
  it("shares one in-flight load between concurrent callers and does not cache failures", async () => {
    let loads = 0;
    const c = new TtlCache<number>(10_000);
    const slow = async () => (++loads, await new Promise((r) => setTimeout(r, 5)), 7);
    expect(await Promise.all([c.get("a", slow), c.get("a", slow), c.get("a", slow)])).toEqual([
      7, 7, 7,
    ]);
    expect(loads).toBe(1);
    await expect(c.get("bad", async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await c.get("bad", async () => 1)).toBe(1);
  });
  it("buckets 6, 10, 25, 50, 100, 250, 500, 1000 USDT; other amounts are exact", () => {
    expect([6, 10, 25, 50, 100, 250, 500, 1000].map(amountBucket)).toEqual([
      "6",
      "10",
      "25",
      "50",
      "100",
      "250",
      "500",
      "1000",
    ]);
    expect(amountBucket(33)).toBe("x33");
    expect(amountBucket(33)).not.toBe(amountBucket(34));
  });
});

describe("Registry", () => {
  const reg = Registry.fromRows([
    {
      ticker: "nvda",
      issuer: "bstock",
      address: "0x02FCA66C1D1AFB4E2A7884261EB00F63598A7436",
      symbol: "NVDAB",
      decimals: 18,
      assetType: 1,
    },
    {
      ticker: "NVDA",
      issuer: "ondo",
      address: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
      symbol: "NVDAon",
      decimals: 18,
      assetType: 1,
    },
    {
      ticker: "NVDA",
      issuer: "xstocks",
      address: "0xc845b2894dbddd03858fd2d643b4ef725fe0849d",
      symbol: "NVDAx",
      decimals: 18,
      assetType: 1,
    },
    {
      ticker: "NVDA",
      issuer: "ondo",
      address: "0xA9EE28C80F960B889DFBD1902055218CBA016F75",
      symbol: "dup",
      decimals: 18,
      assetType: 1,
    },
  ]);
  it("normalises case, de-duplicates by address and marks only bStock and Ondo executable", () => {
    expect(reg.size).toBe(3);
    const t = reg.tokensFor("Nvda");
    expect(t.map((x) => [x.symbol, x.executable])).toEqual([
      ["NVDAB", true],
      ["NVDAon", true],
      ["NVDAx", false],
    ]);
    expect(reg.byAddr("0x02FCA66C1D1AFB4E2A7884261EB00F63598A7436")?.symbol).toBe("NVDAB");
    expect(reg.tokensFor("NOPE")).toEqual([]);
  });
  it("records where each issuer's multiplier comes from", () => {
    expect(reg.tokensFor("NVDA").map((x) => x.multiplierSource)).toEqual([
      "onchain-uiMultiplier",
      "api",
      "onchain-multiplier",
    ]);
  });
});
