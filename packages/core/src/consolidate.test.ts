import { describe, expect, it } from "vitest";
import {
  BelowMinimumError,
  NoReferencePriceError,
  UnknownTickerError,
  consolidatedQuote,
  rank,
  routeText,
  type EnginePorts,
  type QuoteRow,
} from "./consolidate";
import { Registry } from "./registry";
import { statusFromInfo } from "./status";
import { parseDecimal } from "./units";
import type {
  Address,
  KindedError,
  MultiplierReadings,
  RawQuote,
  RegistryToken,
  TokenMarketFacts,
} from "./types";

const E18 = 10n ** 18n;
const m = (s: string) => parseDecimal(s, 18);
const reg = Registry.fromRows([
  {
    ticker: "NVDA",
    issuer: "bstock",
    address: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
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
    ticker: "NFLX",
    issuer: "ondo",
    address: "0x7048f5227b032326cc8dbc53cf3fddd947a2c757",
    symbol: "NFLXon",
    decimals: 18,
    assetType: 1,
  },
  {
    ticker: "NFLX",
    issuer: "bstock",
    address: "0xd6829ea836b6fa224d099d40e54b31262f874631",
    symbol: "NFLXB",
    decimals: 18,
    assetType: 1,
  },
]);
const open = statusFromInfo({ openState: true, marketStatus: "regular", reasonCode: "TRADING" });
const kinded = (kind: KindedError["kind"], msg: string = kind): KindedError =>
  Object.assign(new Error(msg), { kind });

interface Setup {
  mult?: Record<string, MultiplierReadings>;
  facts?: Record<string, Partial<TokenMarketFacts>>;
  /** tokens received per USDT-in (1e18 scaled), per symbol; number of legs; mode */
  q?: Record<string, { tokensPerUsdt: bigint; legs?: number; mode?: string; fail?: KindedError }>;
  ref?: { price: number; session: "regular" | "overnight" } | null;
  gas?: bigint | Error;
}
const DEFAULT_MULT: Record<string, MultiplierReadings> = {
  NVDAB: { onchain: m("1.0008"), api: m("1.0008") },
  NVDAon: { api: m("1.0017") },
  NVDAx: { onchain: m("1.0017"), api: m("1.0009"), list: m("1") },
  NFLXon: { api: m("10") },
  NFLXB: { onchain: m("1"), api: m("1") },
};

function ports(
  s: Setup = {},
): EnginePorts & { quoteCalls: Array<{ symbol: string; amountIn: bigint; wallet: string }> } {
  const quoteCalls: Array<{ symbol: string; amountIn: bigint; wallet: string }> = [];
  return {
    quoteCalls,
    registry: { tokensFor: async (t) => reg.tokensFor(t) },
    facts: {
      multipliers: async (t) => ({ ...DEFAULT_MULT[t.symbol], ...s.mult?.[t.symbol] }),
      market: async (t) => ({
        status: open,
        onchainVolume24hUsd: t.issuer === "xstocks" ? 96 : 5_000_000,
        ...s.facts?.[t.symbol],
      }),
      reference: async () => (s.ref === undefined ? { price: 230, session: "regular" } : s.ref),
    },
    quotes: {
      quote: async (token: RegistryToken, amountIn: bigint, wallet: Address): Promise<RawQuote> => {
        quoteCalls.push({ symbol: token.symbol, amountIn, wallet });
        const cfg = s.q?.[token.symbol] ?? { tokensPerUsdt: E18 / 230n };
        if (cfg.fail) throw cfg.fail;
        const legs = cfg.legs ?? 1;
        return {
          quoteId: `q-${token.symbol}`,
          vendor: "LiquidMesh",
          executionMode: cfg.mode ?? "SWAP",
          amountIn,
          tokensOut: (amountIn * cfg.tokensPerUsdt) / E18,
          usdtPrice: 1,
          priceImpactPct: 0,
          apiGas: 450000,
          hops: Array.from({ length: legs }, (_, i) => ({
            dex: "X",
            toSymbol: i === legs - 1 ? token.symbol : `T${i}`,
          })),
          legCount: legs,
          approveTarget: "0xb44446b0c8e56988c34f7ff73ae904982b5fdda5",
        };
      },
    },
    chain: {
      gasPriceWei: async () => {
        if (s.gas instanceof Error) throw s.gas;
        return s.gas ?? 68_162_033n;
      },
      bnbUsd: async () => 772.8,
    },
    now: () => Date.UTC(2026, 9, 2, 12),
  };
}

describe("consolidatedQuote", () => {
  it("quotes bStock and Ondo with the placeholder wallet, shows xStocks as not executable and never quotes it", async () => {
    const p = ports();
    const r = await consolidatedQuote(p, { ticker: "nvda", amount: { usd: 25 } });
    expect(p.quoteCalls.map((c) => c.symbol).sort()).toEqual(["NVDAB", "NVDAon"]);
    expect(
      p.quoteCalls.every(
        (c) =>
          c.wallet === "0xcb634955B8A7DF7B106f7AB47C9759B26206b777" && c.amountIn === 25n * E18,
      ),
    ).toBe(true);
    const x = r.rows.find((x) => x.symbol === "NVDAx")!;
    expect(x.executable).toBe(false);
    expect(x.sharesOut).toBeUndefined();
    expect(x.integrity.grade).toBe("F"); // disagreement + ghost
    expect(x.integrity.flags).toContain("ghost");
    expect(r.rows.filter((x) => x.executable)).toHaveLength(2);
  });

  it("computes shares = tokens × multiplier, $/share, premium vs reference and the route text", async () => {
    // 25 USDT → 0.1 NVDAB tokens at multiplier 1.0008 → 0.10008 shares → $249.80/share vs 230 ref
    const p = ports({ q: { NVDAB: { tokensPerUsdt: E18 / 250n, legs: 3 } } });
    const r = await consolidatedQuote(p, { ticker: "NVDA", amount: { usd: 25 } });
    const b = r.rows.find((x) => x.symbol === "NVDAB")!;
    expect(b.tokensOut).toBe(100_000_000_000_000_000n);
    expect(b.sharesOut).toBe(100_080_000_000_000_000n);
    expect(b.usdPerShare).toBeCloseTo(25 / 0.10008, 6);
    expect(b.premium).toBeCloseTo(25 / 0.10008 / 230 - 1, 9);
    expect(b.hops).toBe(3);
    expect(b.routeText).toBe("USDT → T0 → T1 → NVDAB");
  });

  it("ranks by effective cost per share including the fee, and reports the saving vs the runner-up", async () => {
    // Ondo gives more tokens but through 4 hops (more gas); the fee decides close calls.
    const p = ports({
      q: {
        NVDAB: { tokensPerUsdt: E18 / 230n, legs: 1 },
        NVDAon: { tokensPerUsdt: ((E18 / 230n) * 10_010n) / 10_000n, legs: 4 },
      },
    });
    const r = await consolidatedQuote(p, { ticker: "NVDA", amount: { usd: 25 } });
    const [b, o] = ["NVDAB", "NVDAon"].map((s) => r.rows.find((x) => x.symbol === s)!);
    expect(o!.usdPerShare!).toBeLessThan(b!.usdPerShare!); // Ondo is cheaper before fees...
    expect(o!.feeUsd!).toBeGreaterThan(b!.feeUsd!); // ...but costs more gas
    const winner = r.rows.find((x) => x.isBest)!;
    const loser = r.rows.find((x) => x.rank === 2)!;
    expect(winner.effectiveCostPerShare!).toBeLessThan(loser.effectiveCostPerShare!);
    expect(r.best).toBe(winner.symbol);
    expect(r.saving).toMatchObject({ vsSymbol: loser.symbol });
    expect(r.saving!.usd).toBeGreaterThan(0);
    expect(r.saving!.pct).toBeGreaterThan(0);
  });

  it("a long route can lose to a short one even when its token price is better (the F6 lesson)", async () => {
    // 6 USDT: a 0.01% better price on a 4-hop route cannot beat the extra ≈$0.01 of gas.
    const p = ports({
      q: {
        NVDAB: { tokensPerUsdt: E18 / 230n, legs: 1 },
        NVDAon: { tokensPerUsdt: ((E18 / 230n) * 10_001n) / 10_000n, legs: 4 },
      },
    });
    const r = await consolidatedQuote(p, { ticker: "NVDA", amount: { usd: 6 } });
    expect(r.best).toBe("NVDAB");
  });

  it("enforces the 6 USDT minimum before calling anything", async () => {
    const p = ports();
    await expect(
      consolidatedQuote(p, { ticker: "NVDA", amount: { usd: 5 } }),
    ).rejects.toBeInstanceOf(BelowMinimumError);
    await expect(consolidatedQuote(p, { ticker: "NVDA", amount: { usd: 5.99 } })).rejects.toThrow(
      /Minimum order is \$6/,
    );
    expect(p.quoteCalls).toHaveLength(0);
    await expect(
      consolidatedQuote(p, { ticker: "NVDA", amount: { usd: 6 } }),
    ).resolves.toBeDefined();
  });

  it("rejects unknown tickers", async () => {
    await expect(
      consolidatedQuote(ports(), { ticker: "ZZZZ", amount: { usd: 25 } }),
    ).rejects.toBeInstanceOf(UnknownTickerError);
  });

  describe("shares mode (§7.4 step 4)", () => {
    it("estimates shares × ref × 1.01, scales once, re-quotes once, and lands on the requested shares", async () => {
      const p = ports();
      const r = await consolidatedQuote(p, { ticker: "NVDA", amount: { shares: 0.5 } });
      const calls = p.quoteCalls.filter((c) => c.symbol === "NVDAon");
      expect(calls).toHaveLength(2);
      expect(Number(calls[0]!.amountIn) / 1e18).toBeCloseTo(0.5 * 230 * 1.01, 4);
      const o = r.rows.find((x) => x.symbol === "NVDAon")!;
      expect(Number(o.sharesOut) / 1e18).toBeGreaterThanOrEqual(0.5); // we never come in under
      expect(Number(o.sharesOut) / 1e18).toBeLessThan(0.5 * 1.002);
    });
    it("clamps up to the 6 USDT minimum for small share amounts", async () => {
      const p = ports();
      await consolidatedQuote(p, { ticker: "NVDA", amount: { shares: 0.01 } });
      expect(p.quoteCalls.every((c) => c.amountIn >= 6n * E18)).toBe(true);
    });
    it("needs a reference price to convert shares to dollars", async () => {
      await expect(
        consolidatedQuote(ports({ ref: null }), { ticker: "NVDA", amount: { shares: 1 } }),
      ).rejects.toBeInstanceOf(NoReferencePriceError);
    });
  });

  describe("what is not executable", () => {
    it("a paused token is shown with its reason and never quoted", async () => {
      const paused = statusFromInfo({
        marketStatus: "paused",
        reasonCode: "MARKET_PAUSED",
        reasonMsg: "Paused for session transition",
      });
      const p = ports({ facts: { NVDAon: { status: paused } } });
      const r = await consolidatedQuote(p, { ticker: "NVDA", amount: { usd: 25 } });
      const o = r.rows.find((x) => x.symbol === "NVDAon")!;
      expect(o).toMatchObject({ executable: false });
      expect(o.notExecutableReason).toMatch(/Paused for session transition/);
      expect(p.quoteCalls.map((c) => c.symbol)).toEqual(["NVDAB"]);
      expect(r.best).toBe("NVDAB");
      expect(r.saving).toBeUndefined(); // nothing to compare against
    });
    it("a ghost market (on-chain volume < $1,000) is blocked even for an executable issuer", async () => {
      const p = ports({ facts: { NVDAB: { onchainVolume24hUsd: 500 } } });
      const r = await consolidatedQuote(p, { ticker: "NVDA", amount: { usd: 25 } });
      expect(r.rows.find((x) => x.symbol === "NVDAB")).toMatchObject({ executable: false });
      expect(p.quoteCalls.map((c) => c.symbol)).toEqual(["NVDAon"]);
    });
    it("unknown status (null) is not assumed open, but is still quotable with a −10 grade", async () => {
      const r = await consolidatedQuote(ports({ facts: { NVDAB: { status: null } } }), {
        ticker: "NVDA",
        amount: { usd: 25 },
      });
      const b = r.rows.find((x) => x.symbol === "NVDAB")!;
      expect(b.executable).toBe(true);
      expect(b.integrity.score).toBe(90);
      expect(b.integrity.reasons.map((x) => x.reason).join()).toMatch(/unknown/);
    });
    it("an Ondo multiplier that fails its bounds blocks execution and is flagged", async () => {
      const p = ports({
        facts: { NVDAon: { multiplierBaseline: { value: m("1.0017"), at: Date.UTC(2026, 9, 1) } } },
        mult: { NVDAon: { api: m("1.0010") } },
      });
      const r = await consolidatedQuote(p, { ticker: "NVDA", amount: { usd: 25 } });
      const o = r.rows.find((x) => x.symbol === "NVDAon")!;
      expect(o.executable).toBe(false);
      expect(o.integrity.flags).toContain("bounds");
      expect(p.quoteCalls.map((c) => c.symbol)).toEqual(["NVDAB"]);
    });
    it("RFQ mode (V8) is quoted for display but not executable: 'needs a signed order'", async () => {
      const r = await consolidatedQuote(
        ports({ q: { NVDAon: { tokensPerUsdt: E18 / 230n, mode: "RFQ" } } }),
        { ticker: "NVDA", amount: { usd: 25 } },
      );
      const o = r.rows.find((x) => x.symbol === "NVDAon")!;
      expect(o).toMatchObject({ executable: false, executionMode: "RFQ" });
      expect(o.notExecutableReason).toMatch(/signed order/);
      expect(r.best).toBe("NVDAB");
    });
    it("no multiplier at all → not executable, not silently priced as 1", async () => {
      const r = await consolidatedQuote(ports({ mult: { NVDAon: { api: undefined } } }), {
        ticker: "NVDA",
        amount: { usd: 25 },
      }).catch((e) => e);
      // default NVDAon reading was api only; overriding with undefined spreads over it
      expect(r.rows.find((x: QuoteRow) => x.symbol === "NVDAon")).toMatchObject({
        executable: false,
        notExecutableReason: "No share multiplier available",
      });
    });
  });

  describe("failures", () => {
    it("a per-token quote failure becomes a row error; the other issuer still ranks", async () => {
      const r = await consolidatedQuote(
        ports({
          q: {
            NVDAon: {
              tokensPerUsdt: 0n,
              fail: kinded("token_unavailable", "Ondo unavailable outside US market hours"),
            },
          },
        }),
        { ticker: "NVDA", amount: { usd: 25 } },
      );
      const o = r.rows.find((x) => x.symbol === "NVDAon")!;
      expect(o.error).toMatchObject({ kind: "token_unavailable" });
      expect(r.best).toBe("NVDAB");
    });
    it("a region block is fatal for the whole call (page ops), not a row error", async () => {
      await expect(
        consolidatedQuote(
          ports({ q: { NVDAB: { tokensPerUsdt: 0n, fail: kinded("region_block", "40304") } } }),
          { ticker: "NVDA", amount: { usd: 25 } },
        ),
      ).rejects.toMatchObject({ kind: "region_block" });
    });
    it("every quote failing is an error, not an empty table", async () => {
      const fail = { tokensPerUsdt: 0n, fail: kinded("upstream") };
      await expect(
        consolidatedQuote(ports({ q: { NVDAB: fail, NVDAon: fail } }), {
          ticker: "NVDA",
          amount: { usd: 25 },
        }),
      ).rejects.toThrow(/Every quote failed/);
    });
    it("a gas-price outage drops the fee, warns, and ranks on price alone", async () => {
      const r = await consolidatedQuote(ports({ gas: new Error("rpc down") }), {
        ticker: "NVDA",
        amount: { usd: 25 },
      });
      expect(r.rows.find((x) => x.symbol === "NVDAB")!.feeUsd).toBeUndefined();
      expect(r.warnings.join()).toMatch(/fee not shown/);
      expect(r.best).toBeDefined();
    });
    it("no reference price: premiums are omitted with a warning", async () => {
      const r = await consolidatedQuote(ports({ ref: null }), {
        ticker: "NVDA",
        amount: { usd: 25 },
      });
      expect(r.rows.find((x) => x.symbol === "NVDAB")!.premium).toBeUndefined();
      expect(r.warnings.join()).toMatch(/reference price/);
    });
  });

  describe("F1: units differ by issuer", () => {
    it("NFLX: Ondo 10 shares per token vs bStock 1 → both flagged as a unit trap, and $/share is still comparable", async () => {
      // Same stock at $680: Ondo tokens cost ~$6800, bStock tokens ~$680. 100 USDT buys different TOKEN counts, same SHARES.
      const p = ports({
        ref: { price: 680, session: "regular" },
        q: { NFLXon: { tokensPerUsdt: E18 / 6800n }, NFLXB: { tokensPerUsdt: E18 / 680n } },
      });
      const r = await consolidatedQuote(p, { ticker: "NFLX", amount: { usd: 100 } });
      const on = r.rows.find((x) => x.symbol === "NFLXon")!;
      const b = r.rows.find((x) => x.symbol === "NFLXB")!;
      expect(on.integrity.unitTrap && b.integrity.unitTrap).toBe(true);
      expect(Number(on.tokensOut) / 1e18).toBeCloseTo(100 / 6800, 6);
      expect(Number(b.tokensOut) / 1e18).toBeCloseTo(100 / 680, 6);
      expect(on.usdPerShare).toBeCloseTo(680, 3);
      expect(b.usdPerShare).toBeCloseTo(680, 3);
      expect(Math.abs(on.premium!)).toBeLessThan(0.0001);
      // A naive comparison of raw token prices would call this a 900% gap:
      expect(6800 / 680 - 1).toBe(9);
    });
  });
});

describe("rank()", () => {
  const row = (symbol: string, eff: number, hops: number, score: number): QuoteRow => ({
    symbol,
    issuer: "ondo",
    address: "0x0" as Address,
    decimals: 18,
    executable: true,
    isBest: false,
    effectiveCostPerShare: eff,
    hops,
    sharesOut: E18,
    integrity: { score, grade: "A", flags: [], reasons: [], unitTrap: false },
  });
  it("ties go to fewer hops, then the better grade", () => {
    const rows = [row("A", 100, 3, 100), row("B", 100, 1, 90), row("C", 100, 1, 100)];
    rank(rows);
    expect(rows.map((r) => [r.symbol, r.rank])).toEqual([
      ["A", 3],
      ["B", 2],
      ["C", 1],
    ]);
  });
  it("a single eligible row is Best with no saving", () => {
    const rows = [row("A", 100, 1, 100)];
    expect(rank(rows)).toEqual({ best: "A" });
  });
  it("routeText joins legs", () => {
    expect(
      routeText({
        hops: [
          { dex: "a", toSymbol: "BTCB" },
          { dex: "b", toSymbol: "NVDAB" },
        ],
      } as RawQuote),
    ).toBe("USDT → BTCB → NVDAB");
  });
});
