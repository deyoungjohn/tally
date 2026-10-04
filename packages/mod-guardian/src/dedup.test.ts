import { describe, expect, it } from "vitest";
import {
  deduplicateAlerts,
  filterAlerts,
  filterAlertsForWallet,
  isQuietHours,
  nextQuietEnd,
} from "./dedup";
import type { Alert, GuardianSettings } from "./types";

const makeAlert = (
  rule: string,
  key: string,
  createdAt: number,
  severity: Alert["severity"] = "warning",
  wallet = "0x2bf7edf53bc6be6ff98f149387f3818ce28d2930",
  idSuffix = "",
): Alert => ({
  id: idSuffix
    ? `${rule}:${idSuffix}:${wallet}:${key}:${createdAt}`
    : `${rule}:${wallet}:${key}:${createdAt}`,
  walletAddress: wallet.toLowerCase(),
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

describe("deduplicateAlerts (finding 3 & 7)", () => {
  it("suppresses duplicate alert for the same rule, wallet and token within cooldown", () => {
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

  // Finding 3 test: two wallets holding the same token each get exactly one alert
  it("allows two wallets holding the same token to each receive their alert", () => {
    const cooldownMs = 86_400_000;
    const t0 = 100_000;
    const walletA = "0xaaaa111122223333444455556666777788889999";
    const walletB = "0xbbbb111122223333444455556666777788889999";

    const alertWalletA = makeAlert("paused", "0xnvda", t0, "warning", walletA);
    const alertWalletB = makeAlert("paused", "0xnvda", t0, "warning", walletB);

    const deduplicated = deduplicateAlerts([alertWalletA, alertWalletB], [], cooldownMs);
    expect(deduplicated).toHaveLength(2);
    expect(deduplicated.map((a) => a.walletAddress)).toEqual([walletA, walletB]);
  });

  // Finding 7 test: min and max price breaches do not suppress each other
  it("does not suppress price-threshold max breach when min breach is in history", () => {
    const cooldownMs = 86_400_000;
    const t0 = 100_000;
    const minAlert = makeAlert("price-threshold", "0xnvda", t0, "warning", undefined, "min");
    const history = [minAlert];

    // Max breach on the same token within cooldown
    const maxAlert = makeAlert("price-threshold", "0xnvda", t0 + 1000, "info", undefined, "max");

    const deduplicated = deduplicateAlerts([maxAlert], history, cooldownMs);
    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0]!.id).toContain(":max:");
  });
});

describe("isQuietHours & nextQuietEnd (finding 6)", () => {
  const quiet = { enabled: true, startHourUtc: 22, endHourUtc: 7 };

  it("correctly evaluates windows crossing midnight (e.g. 22:00 - 07:00 UTC)", () => {
    // 23:00 UTC (11 PM) -> quiet
    const date23 = new Date("2026-10-02T23:00:00Z").getTime();
    expect(isQuietHours(date23, quiet)).toBe(true);

    // 03:00 UTC (3 AM) -> quiet
    const date03 = new Date("2026-10-02T03:00:00Z").getTime();
    expect(isQuietHours(date03, quiet)).toBe(true);

    // 07:00 UTC -> not quiet
    const date0700 = new Date("2026-10-02T07:00:00Z").getTime();
    expect(isQuietHours(date0700, quiet)).toBe(false);
  });

  // Finding 6 test: nextQuietEnd pure helper
  it("calculates exact UTC timestamp when quiet hours end", () => {
    // At 23:00 UTC on 2026-10-02, quiet hours end at 07:00 UTC on 2026-10-03
    const date23 = new Date("2026-10-02T23:00:00Z").getTime();
    const expectedEndTomorrow = new Date("2026-10-03T07:00:00Z").getTime();
    expect(nextQuietEnd(date23, quiet)).toBe(expectedEndTomorrow);

    // At 03:00 UTC on 2026-10-03, quiet hours end at 07:00 UTC on 2026-10-03
    const date03 = new Date("2026-10-03T03:00:00Z").getTime();
    const expectedEndToday = new Date("2026-10-03T07:00:00Z").getTime();
    expect(nextQuietEnd(date03, quiet)).toBe(expectedEndToday);

    // At 14:00 UTC (not in quiet hours), returns now
    const date14 = new Date("2026-10-03T14:00:00Z").getTime();
    expect(nextQuietEnd(date14, quiet)).toBe(date14);
  });
});

describe("filterAlertsForWallet (finding 3)", () => {
  it("returns only alerts belonging to the requested wallet", () => {
    const walletA = "0xaaaa111122223333444455556666777788889999";
    const walletB = "0xbbbb111122223333444455556666777788889999";

    const alertA = makeAlert("paused", "0xnvda", 1000, "warning", walletA);
    const alertB = makeAlert("paused", "0xnvda", 1000, "warning", walletB);

    const feed = [alertA, alertB];
    const filteredA = filterAlertsForWallet(feed, walletA);
    expect(filteredA).toHaveLength(1);
    expect(filteredA[0]!.walletAddress).toBe(walletA);
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
      quietHours: { enabled: true, startHourUtc: 22, endHourUtc: 7 },
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
