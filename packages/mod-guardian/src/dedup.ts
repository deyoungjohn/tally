import type { Alert, GuardianSettings, QuietHours } from "./types";

export function isQuietHours(timestamp: number, quietHours?: QuietHours): boolean {
  if (!quietHours?.enabled) return false;
  const hour = new Date(timestamp).getUTCHours();
  const { startHourUtc, endHourUtc } = quietHours;
  if (startHourUtc === endHourUtc) return true; // 24h quiet
  if (startHourUtc < endHourUtc) {
    return hour >= startHourUtc && hour < endHourUtc;
  }
  // Crosses midnight, e.g. 22:00 to 07:00 UTC
  return hour >= startHourUtc || hour < endHourUtc;
}

/**
 * Returns the UTC timestamp (ms) when current quiet hours end.
 * If now is not within quiet hours, returns now.
 */
export function nextQuietEnd(now: number, quiet?: QuietHours): number {
  if (!quiet?.enabled) return now;
  if (!isQuietHours(now, quiet)) return now;

  const { startHourUtc, endHourUtc } = quiet;
  if (startHourUtc === endHourUtc) {
    return now + 86_400_000;
  }

  // Candidate end time today
  const endToday = new Date(now);
  endToday.setUTCHours(endHourUtc, 0, 0, 0);

  if (endToday.getTime() > now) {
    return endToday.getTime();
  }

  // End time tomorrow
  const endTomorrow = new Date(now + 86_400_000);
  endTomorrow.setUTCHours(endHourUtc, 0, 0, 0);
  return endTomorrow.getTime();
}

export function deduplicationKey(alert: Alert): string {
  const wallet = alert.walletAddress.toLowerCase();
  const tokenKey = alert.evidence.snapshotKey.toLowerCase();

  // Finding 7 / Nit 3: min and max breaches have independent deduplication keys via direction
  if (alert.rule === "price-threshold") {
    const direction =
      alert.direction ??
      (alert.id.includes(":min:") ? "min" : alert.id.includes(":max:") ? "max" : "");
    return `${wallet}:${alert.rule}:${direction}:${tokenKey}`;
  }

  return `${wallet}:${alert.rule}:${tokenKey}`;
}

export function deduplicateAlerts(
  incoming: readonly Alert[],
  history: readonly Alert[],
  cooldownMs = 86_400_000,
): Alert[] {
  const result: Alert[] = [];
  const latestSeen = new Map<string, number>();

  // Seed latest seen from history
  for (const item of history) {
    const key = deduplicationKey(item);
    const existing = latestSeen.get(key) ?? 0;
    if (item.createdAt > existing) {
      latestSeen.set(key, item.createdAt);
    }
  }

  for (const alert of incoming) {
    const key = deduplicationKey(alert);
    const lastEmitted = latestSeen.get(key);
    if (lastEmitted !== undefined && alert.createdAt - lastEmitted < cooldownMs) {
      // Within cooldown, skip
      continue;
    }
    result.push(alert);
    latestSeen.set(key, alert.createdAt);
  }

  return result;
}

export interface AlertFilterResult {
  accepted: Alert[];
  quietSuppressed: Alert[];
  duplicates: Alert[];
}

export function filterAlerts(
  incoming: readonly Alert[],
  history: readonly Alert[],
  settings: GuardianSettings,
  now: number,
): AlertFilterResult {
  const cooldownMs = settings.cooldownMs ?? 86_400_000;
  const accepted: Alert[] = [];
  const quietSuppressed: Alert[] = [];
  const duplicates: Alert[] = [];

  const deduplicated = deduplicateAlerts(incoming, history, cooldownMs);
  const acceptedSet = new Set(deduplicated.map((a) => a.id));

  for (const alert of incoming) {
    if (!acceptedSet.has(alert.id)) {
      duplicates.push(alert);
      continue;
    }

    // Critical alerts bypass quiet hours; warnings/info respect quiet hours
    if (alert.severity !== "critical" && isQuietHours(now, settings.quietHours)) {
      quietSuppressed.push(alert);
    } else {
      accepted.push(alert);
    }
  }

  return { accepted, quietSuppressed, duplicates };
}

/**
 * Filter feed alerts strictly for a specific verified wallet address.
 */
export function filterAlertsForWallet(alerts: readonly Alert[], walletAddress: string): Alert[] {
  const target = walletAddress.toLowerCase();
  return alerts.filter((a) => a.walletAddress.toLowerCase() === target);
}
