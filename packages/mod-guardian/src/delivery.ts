import type { SnapshotStore } from "@tally/modkit";
import { isQuietHours, nextQuietEnd } from "./dedup";
import { getLinkedChatForWallet } from "./link";
import type { Alert } from "./types";

export const MAX_DELIVERY_ATTEMPTS = 5;

export interface TelegramDeliverySender {
  sendMessage(
    chatId: number | string,
    text: string,
    other?: { parse_mode?: string },
  ): Promise<unknown>;
}

export interface DeliverAlertsResult {
  attempted: number;
  delivered: number;
  failed: number;
  suppressedByQuiet: number;
  errors: string[];
  updatedAlerts: Alert[];
}

/** Redacts URLs and potential credentials from error strings (Finding 8 & Finding 6) */
export function redactSecrets(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted url]")
    .replace(/bot\d+:[A-Za-z0-9_-]+/gi, "[redacted token]");
}

/**
 * Formats a plain-text Telegram alert message from an Alert object.
 * Sent as plain text to avoid Telegram Markdown entity parsing failures (Finding 10).
 */
export function formatTelegramAlert(alert: Alert): string {
  const icon = alert.severity === "critical" ? "🚨" : alert.severity === "warning" ? "⚠️" : "ℹ️";
  const lines = [
    `${icon} Guardian Alert: ${alert.title}`,
    "",
    alert.body,
    "",
    `Evidence: ${alert.evidence.snapshotKind} snapshot (${new Date(alert.evidence.observedAt).toISOString()})`,
  ];
  return lines.join("\n");
}

/**
 * Unified delivery processor for Guardian alerts (Finding 7).
 *
 * Requirements:
 * 1. Checks stored alerts for undelivered records whose deliverAt has arrived.
 * 2. Enforces bounded retry count (max 5 attempts).
 * 3. Quiet hours from the link record (UTC):
 *    - Critical alerts bypass quiet hours and are delivered immediately (Slice A rule).
 *    - Non-critical alerts are suppressed until nextQuietEnd.
 * 4. Tracks deliveredAt, deliveryAttempts, and lastDeliveryError directly on the Alert object.
 * 5. Returns updated alerts so the caller can persist delivery state back to SnapshotStore.
 * 6. Errors are collected and redacted so caller can report health ok: false when delivery fails.
 */
export async function deliverPendingAlerts(
  sender: TelegramDeliverySender,
  alerts: readonly Alert[],
  store: SnapshotStore,
  now = Date.now(),
  onWarn: (msg: string) => void = () => {},
): Promise<DeliverAlertsResult> {
  const result: DeliverAlertsResult = {
    attempted: 0,
    delivered: 0,
    failed: 0,
    suppressedByQuiet: 0,
    errors: [],
    updatedAlerts: [],
  };

  const updated: Alert[] = [];

  for (const rawAlert of alerts) {
    const alert: Alert = { ...rawAlert };
    updated.push(alert);

    // Skip already delivered alerts
    if (alert.deliveredAt) {
      continue;
    }

    // Skip alerts that exceeded max delivery attempts
    if ((alert.deliveryAttempts ?? 0) >= MAX_DELIVERY_ATTEMPTS) {
      continue;
    }

    const wallet = alert.walletAddress.toLowerCase();
    const link = getLinkedChatForWallet(store, wallet, now);

    if (!link || !link.alertsEnabled) {
      continue; // Wallet is not linked or user turned alerts off
    }

    const { chatId, quietHours } = link;

    // Check quiet hours:
    // Critical alerts bypass quiet hours; warnings and infos are suppressed.
    if (alert.severity !== "critical" && isQuietHours(now, quietHours)) {
      if (!alert.deliverAt) {
        alert.deliverAt = nextQuietEnd(now, quietHours);
      }
      result.suppressedByQuiet++;
      continue;
    }

    // If a non-critical alert was previously quiet-suppressed, wait until deliverAt has arrived
    if (alert.deliverAt && now < alert.deliverAt) {
      result.suppressedByQuiet++;
      continue;
    }

    // Ready for delivery attempt
    result.attempted++;
    alert.deliveryAttempts = (alert.deliveryAttempts ?? 0) + 1;
    const message = formatTelegramAlert(alert);

    try {
      await sender.sendMessage(chatId, message);
      alert.deliveredAt = now;
      alert.lastDeliveryError = undefined;
      result.delivered++;
    } catch (err) {
      result.failed++;
      const rawMsg = err instanceof Error ? err.message : String(err);
      const safeMsg = redactSecrets(rawMsg);
      alert.lastDeliveryError = safeMsg;
      result.errors.push(safeMsg);
      onWarn(`Failed to deliver Telegram alert to chat ${chatId}: ${safeMsg}`);
    }
  }

  result.updatedAlerts = updated;
  return result;
}
