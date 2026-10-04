import { describe, expect, it } from "vitest";
import { deduplicateAlerts, filterAlerts, isQuietHours } from "./dedup";
import type { Alert, GuardianSettings } from "./types";

const makeAlert = (
  rule: string,
  key: string,
  createdAt: number,
  severity: Alert["severity"] = "warning",
): Alert => ({
  id: `${rule}:${key}:${createdAt}`,
  rule,
  ticker: "NVDA",
  issuer: "ondo",
  severity,
  title: "Test Alert",
  body: "Test Body",
  evidence: {
    snapshotKind: "test",
    snapshotKey: key,
    observedAt: createdAt,
  },
  createdAt,
});

describe("deduplicateAlerts", () => {
  it("suppresses duplicate alert for the same rule and token within cooldown", () => {
    const cooldownMs = 86_400_000; // 24h
    const t0 = 100_000;
    const history = [makeAlert("paused", "0xnvda", t0)];

    // 1 hour later: within cooldown -> duplicate
    const incoming1 = [makeAlert("paused", "0xnvda", t0 + 3_600_000)];
    expect(deduplicateAlerts(incoming1, history, cooldownMs)).toHaveLength(0);

    // 25 hours later: outside cooldown -> accepted
    const incoming2 = [makeAlert("paused", "0xnvda", t0 + 25 * 3_600_000)];
    expect(deduplicateAlerts(incoming2, history, cooldownMs)).toHaveLength(1);
  });

  it("does not suppress alerts for different rules or different tokens", () => {
    const cooldownMs = 86_400_000;
    const t0 = 100_000;
    const history = [makeAlert("paused", "0xnvda", t0)];

    // Different rule on same token
    const alertDifferentRule = makeAlert("grade-drop", "0xnvda", t0 + 1000);
    expect(deduplicateAlerts([alertDifferentRule], history, cooldownMs)).toHaveLength(1);

    // Same rule on different token
    const alertDifferentToken = makeAlert("paused", "0xaapl", t0 + 1000);
    expect(deduplicateAlerts([alertDifferentToken], history, cooldownMs)).toHaveLength(1);
  });
});

describe("isQuietHours", () => {
  it("correctly evaluates windows crossing midnight (e.g. 22:00 - 07:00)", () => {
    const quiet = { enabled: true, startHour: 22, endHour: 7 };

    // 23:00 UTC (11 PM) -> quiet
    const date23 = new Date("2026-10-02T23:00:00Z").getTime();
    expect(isQuietHours(date23, quiet)).toBe(true);

    // 03:00 UTC (3 AM) -> quiet
    const date03 = new Date("2026-10-02T03:00:00Z").getTime();
    expect(isQuietHours(date03, quiet)).toBe(true);

    // 06:59 UTC -> quiet
    const date0659 = new Date("2026-10-02T06:59:00Z").getTime();
    expect(isQuietHours(date0659, quiet)).toBe(true);

    // 07:00 UTC -> not quiet
    const date0700 = new Date("2026-10-02T07:00:00Z").getTime();
    expect(isQuietHours(date0700, quiet)).toBe(false);

    // 14:00 UTC (2 PM) -> not quiet
    const date14 = new Date("2026-10-02T14:00:00Z").getTime();
    expect(isQuietHours(date14, quiet)).toBe(false);
  });

  it("returns false when quiet hours are disabled", () => {
    const quiet = { enabled: false, startHour: 22, endHour: 7 };
    const date03 = new Date("2026-10-02T03:00:00Z").getTime();
    expect(isQuietHours(date03, quiet)).toBe(false);
  });
});

describe("filterAlerts", () => {
  it("allows critical alerts to bypass quiet hours while suppressing non-critical alerts", () => {
    const settings: GuardianSettings = {
      enabled: true,
      rules: {
        paused: true,
        shareCount: true,
        gradeDrop: true,
        ghost: true,
        priceThreshold: true,
        earnings: false,
      },
      quietHours: { enabled: true, startHour: 22, endHour: 7 },
      cooldownMs: 86_400_000,
    };

    const midnight = new Date("2026-10-02T01:00:00Z").getTime();
    const criticalAlert = makeAlert("ghost", "0xnvda", midnight, "critical");
    const warningAlert = makeAlert("paused", "0xaapl", midnight, "warning");

    const result = filterAlerts([criticalAlert, warningAlert], [], settings, midnight);
    expect(result.accepted).toContainEqual(criticalAlert);
    expect(result.quietSuppressed).toContainEqual(warningAlert);
  });
});
