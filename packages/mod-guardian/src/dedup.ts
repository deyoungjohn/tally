import type { Alert, GuardianSettings, QuietHours } from "./types";

export function isQuietHours(timestamp: number, quietHours?: QuietHours): boolean {
  if (!quietHours?.enabled) return false;
  const hour = new Date(timestamp).getUTCHours();
  const { startHour, endHour } = quietHours;
  if (startHour === endHour) return true; // 24h quiet
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  // Crosses midnight, e.g. 22:00 to 07:00
  return hour >= startHour || hour < endHour;
}

export function deduplicationKey(alert: Alert): string {
  const tokenKey = alert.evidence.snapshotKey.toLowerCase();
  return `${alert.rule}:${tokenKey}`;
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
