import { E18, mulDiv } from "@tally/core";
import { describe, expect, it } from "vitest";
import { ALERT_MAX_AGE_MS, decide, effectiveCaps, spentToday } from "./decide";
import {
  constructedAlert,
  constructedPolicy,
  constructedPosition,
  constructedRow,
  CONSTRUCTED_NOW as now,
  CONSTRUCTED_WALLET as wallet,
} from "./fixtures";
import type { Alert, Policy, Position, State } from "./types";

const decision = (
  a: Partial<Alert> = {},
  policy: Partial<Policy> = {},
  position: Partial<Position> = {},
  state: Partial<State> = {},
) =>
  decide(
    constructedAlert(a),
    constructedPolicy(policy),
    { position: constructedPosition(position), rows: [], ...state },
    now,
  );
const live = (usd: bigint, at = now) =>
  constructedRow({
    mode: "live",
    receiptId: "constructed-receipt",
    executedUsd: usd,
    executedAt: at,
  });

it("Ondo ten-shares-per-token and bStock 1:1 execute with issuer multiplier", () => {
  expect(decision()).toEqual({
    decision: "execute",
    reasons: [],
    leg: { ticker: "NFLX", issuer: "ondo", tokens: (25n * E18) / 10n, usdCap: 25n * E18 },
  });
  expect(
    decision({ issuer: "bstock" }, {}, { issuer: "bstock", multiplier: E18, shares: 10n * E18 }),
  ).toMatchObject({ decision: "execute", leg: { tokens: 10n * E18, usdCap: 10n * E18 } });
});

describe("exact refusal reasons", () => {
  const checks: Array<
    [string, Partial<Alert>, Partial<Policy>, Partial<Position>, Partial<State>?]
  > = [
    ["kill switch on", {}, { killSwitch: true }, {}],
    ["rule not armed", {}, { armedRules: {} }, {}],
    ["token not allowed", {}, { tokenAllowList: [] }, {}],
    [
      "outside the regular session",
      { rule: "price-threshold", direction: "min" },
      {
        armedRules: { "price-threshold": { stopUsdPerShare: E18 } },
        isRegularSession: () => false,
      },
      {},
    ],
    [
      "session unknown",
      { rule: "price-threshold", direction: "min" },
      { armedRules: { "price-threshold": { stopUsdPerShare: E18 } } },
      {},
    ],
    ["cap reached (per trade)", {}, { perTradeCap: 6n * E18 - 1n }, {}],
    ["cap reached (per day)", {}, {}, {}, { rows: [live(50n * E18)] }],
    [
      "position below the 6 USDT minimum",
      {},
      {},
      { chainBalanceTokens: (6n * E18) / 10n - 1n, shares: 6n * E18 - 1n },
    ],
    ["alert stale", { createdAt: now - ALERT_MAX_AGE_MS - 1 }, {}, {}],
    [
      "alert already decided",
      {},
      {},
      {},
      { rows: [constructedRow({ alertId: constructedAlert().id })] },
    ],
    [
      "issuer not sellable (xStocks have no market)",
      { issuer: "xstocks" },
      {},
      { issuer: "xstocks" },
    ],
    ["unknown multiplier", {}, {}, { multiplier: null }],
    ["unknown shares", {}, {}, { shares: null }],
    ["chain balance unavailable", {}, {}, { balanceSource: "unknown" }],
    ["position stale", {}, {}, { observedAt: now - 60_001 }],
    ["position does not match alert", {}, {}, { walletAddress: "other-wallet" }],
    ["unknown share price", {}, {}, { usdPerShare: null }],
    ["unknown token decimals", {}, {}, { tokenDecimals: -1 }],
  ];
  it.each(checks)("%s", (reason, a, p, pos, state) => {
    expect(decision(a, p, pos, state)).toEqual({ decision: "alertOnly", reasons: [reason] });
  });
  it("missing position refuses every missing fact; never guesses 1:1", () => {
    const result = decision({}, {}, {}, { position: null });
    expect(result.decision).toBe("alertOnly");
    expect(result.reasons).toEqual([
      "unknown multiplier",
      "unknown shares",
      "chain balance unavailable",
      "unknown share price",
      "grade unknown",
    ]);
  });
  it("stale evidence and future alerts fail closed", () => {
    expect(
      decision({ evidence: { ...constructedAlert().evidence, observedAt: now - 60_001 } }).reasons,
    ).toEqual(["alert stale"]);
    expect(decision({ createdAt: now + 1 }).reasons).toEqual(["alert stale"]);
    expect(decision({ createdAt: now - 60_000 })).toMatchObject({ decision: "execute" });
  });
  it("unsupported Guardian rules are unarmed, even when other rules are armed", () => {
    for (const rule of ["share-count", "ghost", "earnings", "unrecognized"])
      expect(decision({ rule }).reasons).toEqual(["rule not armed"]);
  });
});

it("pause must be continuously longer than the armed threshold, not equal", () => {
  const p = { armedRules: { paused: { longerThanHours: 2 } } };
  expect(
    decision({ rule: "paused" }, p, { paused: true, pausedSince: now - 7_200_001 }).decision,
  ).toBe("execute");
  expect(
    decision({ rule: "paused" }, p, { paused: true, pausedSince: now - 7_200_000 }).reasons,
  ).toEqual(["rule condition not met"]);
  expect(decision({ rule: "paused" }, p).reasons).toEqual(["pause duration unknown"]);
  expect(
    decision({ rule: "paused" }, { armedRules: { paused: { longerThanHours: -1 } } }).reasons,
  ).toEqual(["invalid pause threshold"]);
});
it("grade rule checks D or lower; missing and improved grades refuse", () => {
  expect(decision({}, {}, { grade: "F" }).decision).toBe("execute");
  expect(decision({}, {}, { grade: "C" }).reasons).toEqual(["rule condition not met"]);
  expect(decision({}, { armedRules: { "grade-drop": { atOrBelow: "F" } } }).reasons).toEqual([
    "rule condition not met",
  ]);
  expect(decision({}, {}, { grade: null }).reasons).toEqual(["grade unknown"]);
});
it("per-share stop requires regular session, a downward alert and the armed price", () => {
  const p: Partial<Policy> = {
    armedRules: { "price-threshold": { stopUsdPerShare: E18 } },
    isRegularSession: (time) => time === now,
  };
  expect(decision({ rule: "price-threshold", direction: "min" }, p).decision).toBe("execute");
  expect(decision({ rule: "price-threshold", direction: "max" }, p).reasons).toEqual([
    "rule condition not met",
  ]);
  expect(
    decision({ rule: "price-threshold", direction: "min" }, p, { usdPerShare: E18 + 1n }).reasons,
  ).toEqual(["rule condition not met"]);
});

it("ceilings cannot be exceeded by policy; unset values default to 25 and 50", () => {
  expect(effectiveCaps({})).toEqual({ perTrade: 25n * E18, daily: 50n * E18 });
  expect(effectiveCaps({ perTradeCap: 100n * E18 + 1n, dailyCap: 250n * E18 + 1n })).toEqual({
    perTrade: 100n * E18,
    daily: 250n * E18,
  });
  expect(
    decision(
      {},
      { perTradeCap: 999n * E18, dailyCap: 999n * E18 },
      { chainBalanceTokens: 100n * E18, shares: 1000n * E18 },
    ).leg?.usdCap,
  ).toBe(100n * E18);
  expect(decision({}, { dailyCap: 999n * E18 }, {}, { rows: [live(250n * E18)] }).reasons).toEqual([
    "cap reached (per day)",
  ]);
});
it("caps floor exactly at the cap and one USD wei above; min position/trade/day", () => {
  expect(
    decision({}, {}, { multiplier: E18, shares: 25n * E18, chainBalanceTokens: 25n * E18 }).leg
      ?.tokens,
  ).toBe(25n * E18);
  expect(
    decision(
      {},
      {},
      { multiplier: E18, shares: 25n * E18 + 1n, chainBalanceTokens: 25n * E18 + 1n },
    ).leg?.tokens,
  ).toBe(25n * E18);
  const rows = [live(44n * E18)];
  expect(decision({}, {}, {}, { rows }).leg?.usdCap).toBe(6n * E18);
  expect(decision({}, {}, {}, { rows: [live(44n * E18 + 1n)] }).reasons).toEqual([
    "cap reached (per day)",
  ]);
  expect(decision({}, { perTradeCap: 0n }).reasons).toEqual(["cap reached (per trade)"]);
});
it("exact $6.00 is sellable, one wei below and conversion dust refuse", () => {
  expect(
    decision({}, {}, { shares: 6n * E18, chainBalanceTokens: (6n * E18) / 10n }).leg?.usdCap,
  ).toBe(6n * E18);
  expect(decision({}, {}, { shares: 6n * E18 - 1n }).reasons).toEqual([
    "position below the 6 USDT minimum",
  ]);
  expect(
    decision({}, { perTradeCap: 6n * E18 }, { multiplier: 7n * E18, shares: 70n * E18 }).reasons,
  ).toEqual(["position below the 6 USDT minimum"]);
});
it("chain balance bounds reported shares and token decimals are respected", () => {
  expect(decision({}, {}, { chainBalanceTokens: E18 }).leg?.tokens).toBe(E18);
  expect(decision({}, {}, { tokenDecimals: 6, chainBalanceTokens: 10_000_000n }).leg?.tokens).toBe(
    2_500_000n,
  );
  const pos = constructedPosition({ multiplier: 10n * E18 + 42n, usdPerShare: 13n * E18 + 9n });
  const result = decide(constructedAlert(), constructedPolicy(), { position: pos, rows: [] }, now);
  expect(result.leg).toBeDefined();
  const usd = mulDiv(mulDiv(result.leg!.tokens, pos.multiplier!, E18), pos.usdPerShare!, E18);
  expect(usd).toBeLessThanOrEqual(25n * E18);
});
it("spentToday uses actual live receipt evidence, wallet isolation, and UTC midnight execution day", () => {
  const midnight = Date.UTC(2026, 9, 7);
  const rows = [live(5n * E18, midnight - 1), live(7n * E18, midnight)];
  expect(spentToday(rows.slice(0, 1), wallet, midnight - 1)).toBe(5n * E18);
  expect(spentToday(rows, wallet, midnight)).toBe(7n * E18);
  expect(spentToday([constructedRow(), live(9n * E18)], "other-wallet", now)).toBe(0n);
  expect(spentToday([constructedRow()], wallet, now)).toBe(0n);
  expect(() =>
    spentToday([constructedRow({ mode: "live", executedUsd: -1n, executedAt: now })], wallet, now),
  ).toThrow("Invalid executed decision evidence");
});

it("a live receipt with missing spend evidence fails closed rather than resetting the budget", () => {
  expect(() =>
    spentToday([constructedRow({ mode: "live", receiptId: "constructed-receipt" })], wallet, now),
  ).toThrow("Invalid executed decision evidence");
});

it("omitted facts refuse explicitly; an omitted kill switch never arms a sale", () => {
  expect(decision({}, {}, { shares: undefined }).reasons).toEqual(["unknown shares"]);
  expect(decision({}, {}, { multiplier: undefined }).reasons).toEqual(["unknown multiplier"]);
  expect(decision({}, {}, { chainBalanceTokens: undefined }).reasons).toEqual([
    "chain balance unavailable",
  ]);
  expect(decision({}, {}, { usdPerShare: undefined }).reasons).toEqual(["unknown share price"]);
  expect(decision({}, { killSwitch: undefined }).reasons).toEqual(["kill switch unknown"]);
});
