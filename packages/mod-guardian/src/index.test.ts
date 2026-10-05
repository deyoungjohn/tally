import { describe, expect, it } from "vitest";
import * as guardian from "./index";

describe("@tally/mod-guardian exports", () => {
  it("exports rules and evaluator functions", () => {
    expect(guardian.PausedRule).toBeDefined();
    expect(guardian.ShareCountRule).toBeDefined();
    expect(guardian.GradeDropRule).toBeDefined();
    expect(guardian.GhostRule).toBeDefined();
    expect(guardian.PriceThresholdRule).toBeDefined();
    expect(guardian.EarningsRule).toBeDefined();
    expect(guardian.createDefaultRules).toBeDefined();
    expect(guardian.evaluateHoldingRules).toBeDefined();
    expect(guardian.buildTokenStateFromSnapshots).toBeDefined();
    expect(guardian.deduplicateAlerts).toBeDefined();
    expect(guardian.filterAlerts).toBeDefined();
    expect(guardian.isQuietHours).toBeDefined();
  });

  it("creates default rules with expected IDs", () => {
    const rules = guardian.createDefaultRules();
    expect(rules).toHaveLength(6);
    expect(rules.map((r) => r.id)).toEqual([
      "paused",
      "share-count",
      "grade-drop",
      "ghost",
      "price-threshold",
      "earnings",
    ]);
  });
});
