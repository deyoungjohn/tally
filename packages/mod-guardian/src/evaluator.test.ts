import { describe, expect, it } from "vitest";
import { buildTokenStateFromSnapshots, evaluateHoldingRules } from "./evaluator";
import { PriceThresholdRule } from "./rules/price-threshold";
import type { Rule } from "./rules/interface";
import type { GuardianSettings, TokenState, UserHolding } from "./types";

const mockHolding: UserHolding = {
  walletAddress: "0x2bf7edf53bc6be6ff98f149387f3818ce28d2930",
  tokenAddress: "0xnvdaonaddress",
  ticker: "NVDA",
  issuer: "ondo",
  tokens: 10n * 10n ** 18n,
  shares: 10n * 10n ** 18n,
};

describe("Rule Fault Isolation", () => {
  it("continues evaluating remaining rules when one rule throws", () => {
    const warnings: string[] = [];
    const onWarn = (msg: string) => warnings.push(msg);

    // Rule that throws an error unexpectedly
    const faultyRule: Rule = {
      id: "faulty-exploding-rule",
      name: "Exploding Rule",
      description: "Throws an error to test fault isolation",
      evaluate: () => {
        throw new Error("Simulated critical parser explosion or unhandled exception");
      },
    };

    // Valid rule that succeeds and produces an alert
    const workingRule: Rule = {
      id: "working-rule",
      name: "Working Rule",
      description: "Always produces an alert",
      evaluate: (_prev, next, holding) => [
        {
          id: `working:${holding.walletAddress}:${next.tokenAddress}:${next.observedAt}`,
          walletAddress: holding.walletAddress.toLowerCase(),
          rule: "working-rule",
          ticker: holding.ticker,
          issuer: holding.issuer,
          severity: "info",
          title: "Working Alert",
          body: "This alert succeeded despite sibling rule failure.",
          evidence: {
            snapshotKind: "test",
            snapshotKey: next.tokenAddress,
            observedAt: next.observedAt,
          },
          createdAt: next.observedAt,
        },
      ],
    };

    const rules: Rule[] = [faultyRule, workingRule];
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: null,
      multiplier: 10n ** 18n,
      grade: "A",
      gradeReasons: [],
      ghost: false,
      sharePriceUsd: 230,
      session: "regular",
      observedAt: 1000,
      isPausedOnchain: null,
    };
    const next: TokenState = { ...prev, observedAt: 2000 };

    const alerts = evaluateHoldingRules(
      rules,
      prev,
      next,
      mockHolding,
      undefined,
      undefined,
      onWarn,
    );

    // Verify working rule's alert was produced
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.rule).toBe("working-rule");
    expect(alerts[0]!.walletAddress).toBe(mockHolding.walletAddress.toLowerCase());

    // Verify warning was logged for the faulty rule without crashing
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("faulty-exploding-rule");
    expect(warnings[0]).toContain("Simulated critical parser explosion");
  });
});

describe("buildTokenStateFromSnapshots (type guards, finding 1, 2, 8)", () => {
  // Finding 1 test: status.reasonMsg is never overwritten by Radar reasons
  it("preserves status.reasonMsg untouched when Radar snapshot has reasons", () => {
    const rawStatus = {
      kind: "limited" as const,
      reasonCode: "ASSET_LIMITED",
      reasonMsg: "stock_split",
      session: "regular" as const,
    };

    const rawRadar = {
      ticker: "NVDA",
      address: "0xnvdaonaddress",
      issuer: "ondo" as const,
      score: 75,
      grade: "C" as const,
      ghost: false,
      reasons: ["No recent trade for 2 days", "High concentration"],
    };

    const state = buildTokenStateFromSnapshots({
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      observedAt: 1000,
      rawStatus,
      rawRadar,
    });

    // status.reasonMsg MUST stay "stock_split" and NOT be overwritten by radar reason
    expect(state.status?.reasonMsg).toBe("stock_split");
    // Radar reasons are kept in gradeReasons
    expect(state.gradeReasons).toEqual(["No recent trade for 2 days", "High concentration"]);
    expect(state.grade).toBe("C");
  });

  // Nit 2 test: pause state is passed directly as isPausedOnchain: boolean | null
  it("records boolean in isPausedOnchain when passed", () => {
    const state = buildTokenStateFromSnapshots({
      tokenAddress: "0xnvdab",
      ticker: "NVDA",
      issuer: "bstock",
      observedAt: 1000,
      isPausedOnchain: true,
    });

    expect(state.isPausedOnchain).toBe(true);
  });

  it("warns and sets isPausedOnchain to null when pause check is missing for bStock", () => {
    const warnings: string[] = [];
    const onWarn = (msg: string) => warnings.push(msg);

    const stateMissing = buildTokenStateFromSnapshots({
      tokenAddress: "0xnvdab",
      ticker: "NVDA",
      issuer: "bstock",
      observedAt: 1000,
      onWarn,
    });

    expect(stateMissing.isPausedOnchain).toBeNull();
    expect(warnings.some((w) => w.includes("Pause check unavailable for bStock"))).toBe(true);

    const stateExplicitNull = buildTokenStateFromSnapshots({
      tokenAddress: "0xnvdab",
      ticker: "NVDA",
      issuer: "bstock",
      observedAt: 1000,
      isPausedOnchain: null,
      onWarn,
    });

    expect(stateExplicitNull.isPausedOnchain).toBeNull();
  });

  // Finding 8 test: reads lastRealTradeAgeMs from flow-aggregate
  it("populates lastRealTradeAgeDays from rawFlowAggregate", () => {
    const rawFlowAggregate = {
      ticker: "NVDA",
      issuer: "bstock" as const,
      address: "0xnvdab",
      lastRealTradeAt: 1000,
      lastRealTradeAgeMs: 3 * 86_400_000, // 3 days
      lastRealTradeReason: null,
    };

    const state = buildTokenStateFromSnapshots({
      tokenAddress: "0xnvdab",
      ticker: "NVDA",
      issuer: "bstock",
      observedAt: 1000,
      rawFlowAggregate,
    });

    expect(state.lastRealTradeAgeDays).toBe(3);
  });

  it("resolves ghost from flow-ghost when fresh and not skipped", () => {
    const flowGhostRaw = {
      id: "cleaned-flow",
      outcome: "pass",
      points: 0,
      ghost: false,
      reason: "Cleaned flow is active",
      inputs: { realVolume24hUsd: 50_000n * 10n ** 18n, lastRealTradeAgeMs: 10_000, reason: null },
    };

    const radarRaw = {
      ticker: "NVDA",
      address: "0xnvdaonaddress",
      issuer: "ondo" as const,
      score: 95,
      grade: "A" as const,
      ghost: false,
    };

    const state = buildTokenStateFromSnapshots({
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      observedAt: 1000,
      rawRadar: radarRaw,
      rawFlowGhost: flowGhostRaw,
      isFlowGhostStale: false,
    });

    expect(state.ghost).toBe(false);
    expect(state.evidenceKey).toBe("flow-ghost");
    expect(state.grade).toBe("A");
  });

  it("falls back to radar ghost with warning when flow-ghost is stale", () => {
    const warnings: string[] = [];
    const flowGhostRaw = {
      id: "cleaned-flow",
      outcome: "pass",
      points: 0,
      ghost: false,
      reason: "Cleaned flow is active",
    };

    const radarRaw = {
      ticker: "NVDA",
      address: "0xnvdaonaddress",
      issuer: "ondo" as const,
      grade: "B" as const,
      ghost: true,
    };

    const state = buildTokenStateFromSnapshots({
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      observedAt: 1000,
      rawRadar: radarRaw,
      rawFlowGhost: flowGhostRaw,
      isFlowGhostStale: true, // Stale!
      onWarn: (msg) => warnings.push(msg),
    });

    expect(state.ghost).toBe(true);
    expect(state.evidenceKey).toBe("radar");
    expect(warnings.some((w) => w.includes("stale"))).toBe(true);
  });

  it("falls back to radar ghost with warning when flow-ghost outcome is skipped", () => {
    const warnings: string[] = [];
    const flowGhostRaw = {
      id: "cleaned-flow",
      outcome: "skipped",
      points: 0,
      ghost: null,
      reason: "Cleaned volume unavailable",
    };

    const radarRaw = {
      ticker: "NVDA",
      address: "0xnvdaonaddress",
      issuer: "ondo" as const,
      grade: "D" as const,
      ghost: true,
    };

    const state = buildTokenStateFromSnapshots({
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      observedAt: 1000,
      rawRadar: radarRaw,
      rawFlowGhost: flowGhostRaw,
      isFlowGhostStale: false,
      onWarn: (msg) => warnings.push(msg),
    });

    expect(state.ghost).toBe(true);
    expect(state.evidenceKey).toBe("radar");
    expect(warnings.some((w) => w.includes("skipped"))).toBe(true);
  });

  it("rejects malformed radar snapshots without crashing and logs warning", () => {
    const warnings: string[] = [];
    const malformedRadar = {
      ticker: 12345, // invalid type
      grade: "INVALID_GRADE",
    };

    const state = buildTokenStateFromSnapshots({
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      observedAt: 1000,
      rawRadar: malformedRadar,
      onWarn: (msg) => warnings.push(msg),
    });

    expect(state.grade).toBeNull();
    expect(warnings.some((w) => w.includes("unexpected shape"))).toBe(true);
  });
});

describe("Price Threshold Settings Integration (finding 5)", () => {
  // Finding 5 test: evaluateHoldingRules merges settings.priceThresholds with lowercased keys
  it("evaluates price thresholds when configured only in settings and no ports are provided", () => {
    const settings: GuardianSettings = {
      enabled: true,
      rules: {
        paused: false,
        shareCount: false,
        gradeDrop: false,
        ghost: false,
        priceThreshold: true,
        earnings: false,
      },
      priceThresholds: {
        "0xNVDAonAddress": { minPriceUsd: 120 }, // Mixed case key
      },
    };

    const rule = new PriceThresholdRule();
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: null,
      multiplier: 10n ** 18n,
      grade: "A",
      gradeReasons: [],
      ghost: false,
      sharePriceUsd: 130,
      session: "regular",
      observedAt: 1000,
      isPausedOnchain: null,
    };

    const next: TokenState = {
      ...prev,
      sharePriceUsd: 115, // crossed below 120
      observedAt: 2000,
    };

    // No ports provided! Only settings provided
    const alerts = evaluateHoldingRules([rule], prev, next, mockHolding, undefined, settings);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.title).toBe("NVDA fell below $120.00");
    expect(alerts[0]!.walletAddress).toBe(mockHolding.walletAddress.toLowerCase());
  });

  // Finding 3: Two wallets holding same token both receive alerts against previous state
  it("evaluates multiple wallets against the same previous state so second wallet never misses transition", () => {
    const rule = new PriceThresholdRule();
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: null,
      multiplier: 10n ** 18n,
      grade: "A",
      gradeReasons: [],
      ghost: false,
      sharePriceUsd: 130,
      session: "regular",
      observedAt: 1000,
      isPausedOnchain: null,
    };

    const next: TokenState = {
      ...prev,
      sharePriceUsd: 110,
      observedAt: 2000,
    };

    const holdingWallet1: UserHolding = {
      walletAddress: "0x1111111111111111111111111111111111111111",
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      tokens: 10n * 10n ** 18n,
      shares: 10n * 10n ** 18n,
    };

    const holdingWallet2: UserHolding = {
      walletAddress: "0x2222222222222222222222222222222222222222",
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      tokens: 20n * 10n ** 18n,
      shares: 20n * 10n ** 18n,
    };

    const ports = {
      priceThresholds: {
        "0xnvdaonaddress": { minPriceUsd: 120 },
      },
    };

    // Both wallets are evaluated using the token's prev and next state
    const alerts1 = evaluateHoldingRules([rule], prev, next, holdingWallet1, ports);
    const alerts2 = evaluateHoldingRules([rule], prev, next, holdingWallet2, ports);

    expect(alerts1).toHaveLength(1);
    expect(alerts1[0]!.walletAddress).toBe(holdingWallet1.walletAddress.toLowerCase());
    expect(alerts1[0]!.title).toContain("fell below $120.00");

    expect(alerts2).toHaveLength(1);
    expect(alerts2[0]!.walletAddress).toBe(holdingWallet2.walletAddress.toLowerCase());
    expect(alerts2[0]!.title).toContain("fell below $120.00");
  });
});
