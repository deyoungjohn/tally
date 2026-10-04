import { describe, expect, it, vi } from "vitest";
import { E18, type Address } from "@tally/core";
import { createFixtureEngine } from "./engine";
import { sharesOf } from "./shares";
import { fixtureTradeChain } from "./trade-fixture";

const USER = "0x1111111111111111111111111111111111111111" as Address;
const oneToken = () => ({
  ...fixtureTradeChain(),
  erc20Balances: async (_address: Address, tokens: Address[]) => tokens.map(() => E18),
});

describe("bigint holdings accessor against recorded registry and facts", () => {
  it("converts one NFLX Ondo token to ten shares versus bStock one share without dropping xStocks", async () => {
    const engine = createFixtureEngine({ tradeChain: oneToken() });
    const report = await engine.sharesOf(USER, ["NFLX"]);
    expect(report.rows).toHaveLength(3);
    expect(report.rows.find((r) => r.issuer === "ondo")).toMatchObject({
      balance: E18,
      multiplier: 10n * E18,
      shares: 10n * E18,
      source: "api",
    });
    expect(report.rows.find((r) => r.issuer === "bstock")).toMatchObject({
      multiplier: E18,
      shares: E18,
      source: "onchain",
    });
    expect(typeof report.groups[0]!.shares).toBe("bigint");
  });
  it("unknown multiplier remains null with a reason, including nonzero and zero balances", async () => {
    const engine = createFixtureEngine({ tradeChain: oneToken() });
    const multipliers = engine.ports.facts.multipliers;
    engine.ports.facts.multipliers = (token) =>
      token.issuer === "ondo" ? Promise.resolve({}) : multipliers(token);
    const report = await engine.sharesOf(USER, ["NFLX"]);
    expect(report.rows).toHaveLength(3);
    expect(report.rows.find((r) => r.issuer === "ondo")).toMatchObject({
      balance: E18,
      multiplier: null,
      shares: null,
      source: null,
      reason: expect.stringContaining("No accepted share multiplier"),
    });
    expect(report.groups[0]!.shares).toBeNull();
    const empty = await sharesOf(
      engine.ports,
      { erc20Balances: async (_, tokens) => tokens.map(() => 0n) },
      USER,
      ["NFLX"],
    );
    expect(empty.rows.find((r) => r.issuer === "ondo")!.shares).toBeNull();
    expect(empty.rows).toHaveLength(3);
  });
  it("retains exact precision above Number.MAX_SAFE_INTEGER", async () => {
    const raw = 123_456_789_123_456_789_123_456_789n;
    const engine = createFixtureEngine({
      tradeChain: { ...oneToken(), erc20Balances: async (_, tokens) => tokens.map(() => raw) },
    });
    const report = await engine.sharesOf(USER, ["NFLX"]);
    expect(report.rows.find((r) => r.issuer === "ondo")!.shares).toBe(raw * 10n);
  });
  it("balance source down preserves every row with null balance and calls onWarn", async () => {
    const warn = vi.fn();
    const engine = createFixtureEngine({
      onWarn: warn,
      tradeChain: {
        ...oneToken(),
        erc20Balances: async () => {
          throw new Error("RPC down");
        },
      },
    });
    const report = await engine.sharesOf(USER, ["NVDA"]);
    expect(report.rows).toHaveLength(3);
    expect(
      report.rows.every(
        (r) => r.balance === null && r.shares === null && r.reason?.includes("balance unavailable"),
      ),
    ).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
  it("facts source down preserves every token; registry failure is explicit", async () => {
    const warn = vi.fn();
    const engine = createFixtureEngine({ tradeChain: oneToken() });
    const broken = {
      ...engine.ports,
      facts: {
        ...engine.ports.facts,
        multipliers: async () => {
          throw Object.assign(new Error("region"), { kind: "region_block" });
        },
      },
    };
    const report = await sharesOf(broken, oneToken(), USER, ["NVDA"], warn);
    expect(report.rows).toHaveLength(3);
    expect(report.rows.every((r) => r.shares === null && r.reason !== null)).toBe(true);
    expect(warn).toHaveBeenCalled();
    const missing = await sharesOf(engine.ports, oneToken(), USER, ["INVALID"], warn);
    expect(missing.failed).toEqual([
      { ticker: "INVALID", message: expect.stringContaining("Registry unavailable") },
    ]);
    expect(missing.groups[0]!.shares).toBeNull();
  });
  it("a rejected Ondo reading cannot become a holding multiplier", async () => {
    const engine = createFixtureEngine({ tradeChain: oneToken() });
    const read = engine.ports.facts.multipliers;
    engine.ports.facts.multipliers = (t) =>
      t.issuer === "ondo" ? Promise.resolve({ api: 9n * E18, list: 9n * E18 }) : read(t);
    const report = await engine.sharesOf(USER, ["NFLX"]);
    expect(report.rows.find((r) => r.issuer === "ondo")).toMatchObject({
      multiplier: null,
      shares: null,
      reason: expect.stringContaining("rejected"),
    });
  });
  it("a shorter balance response marks the missing rows unknown, never zero", async () => {
    const engine = createFixtureEngine({
      tradeChain: { ...oneToken(), erc20Balances: async () => [E18] },
    });
    const report = await engine.sharesOf(USER, ["NFLX"]);
    expect(report.rows).toHaveLength(3);
    expect(report.rows.slice(1).every((r) => r.balance === null && r.shares === null)).toBe(true);
  });
});
