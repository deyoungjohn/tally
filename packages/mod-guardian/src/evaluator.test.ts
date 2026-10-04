import { describe, expect, it } from "vitest";
import { buildTokenStateFromSnapshots, evaluateHoldingRules } from "./evaluator";
import type { Rule } from "./rules/interface";
import type { TokenState, UserHolding } from "./types";

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
          id: `working:${next.tokenAddress}:${next.observedAt}`,
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
      ghost: false,
      sharePriceUsd: 230,
      session: "regular",
      observedAt: 1000,
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

    // Verify warning was logged for the faulty rule without crashing
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("faulty-exploding-rule");
    expect(warnings[0]).toContain("Simulated critical parser explosion");
  });
});

describe("buildTokenStateFromSnapshots (type guards & fallback)", () => {
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
      issuer: "ondo",
      score: 95,
      grade: "A",
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
      issuer: "ondo",
      grade: "B",
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
      issuer: "ondo",
      grade: "D",
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
