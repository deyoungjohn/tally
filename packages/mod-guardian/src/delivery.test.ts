import { describe, expect, it } from "vitest";
import { openStore } from "@tally/modkit";
import {
  deliverPendingAlerts,
  formatTelegramAlert,
  MAX_DELIVERY_ATTEMPTS,
  redactSecrets,
} from "./delivery";
import { createLinkCode, consumeLinkCode } from "./link";
import type { Alert } from "./types";

describe("Alert Delivery Pipeline (delivery.ts)", () => {
  it("redacts secret API keys and URLs containing query parameters", () => {
    const raw =
      "Request failed: https://bsc-dataseed.binance.org/?apiKey=secret_key_12345 with status 500";
    const redacted = redactSecrets(raw);
    expect(redacted).not.toContain("secret_key");
    expect(redacted).toContain("[redacted url]");
  });

  it("formats plain text alert message with facts and evidence", () => {
    const alert: Alert = {
      id: "paused:0xwallet:0xnvdab:1000",
      walletAddress: "0xwallet",
      rule: "paused",
      ticker: "NVDA",
      issuer: "bstock",
      severity: "warning",
      title: "NVDA via bStock is paused",
      body: "NVDA via bStock is paused by its pause manager.",
      evidence: {
        snapshotKind: "status",
        snapshotKey: "0xnvdab",
        observedAt: 1_700_000_000_000,
      },
      createdAt: 1_700_000_000_000,
    };

    const msg = formatTelegramAlert(alert);
    expect(msg).toContain("⚠️ Guardian Alert: NVDA via bStock is paused");
    expect(msg).toContain("NVDA via bStock is paused by its pause manager.");
    expect(msg).toContain("Evidence: status snapshot");
    // Must be plain text, no raw unescaped markdown tokens that cause Telegram 400 errors
    expect(msg).not.toContain("`");
    expect(msg).not.toContain("*");
  });

  it("updates alert with deliveredAt and clears lastDeliveryError on success", async () => {
    const store = openStore(":memory:");
    const wallet = "0x2bf7edf53bc6be6ff98f149387f3818ce28d2930";
    const chatId = 987654;
    const now = 1_000_000;

    const { code } = createLinkCode(store, wallet, now);
    consumeLinkCode(store, code, chatId, now + 1000);

    const alert: Alert = {
      id: "alert1",
      walletAddress: wallet,
      rule: "paused",
      ticker: "NVDA",
      issuer: "bstock",
      severity: "warning",
      title: "NVDA paused",
      body: "Token paused.",
      evidence: { snapshotKind: "status", snapshotKey: "0xnvdab", observedAt: now },
      createdAt: now,
      lastDeliveryError: "Previous attempt failed",
    };

    const sent: Array<{ chatId: number | string; text: string }> = [];
    const mockSender = {
      async sendMessage(cid: number | string, text: string) {
        sent.push({ chatId: cid, text });
      },
    };

    const result = await deliverPendingAlerts(mockSender, [alert], store, now + 2000);

    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe(chatId);

    const updated = result.updatedAlerts[0]!;
    expect(updated.deliveredAt).toBe(now + 2000);
    expect(updated.lastDeliveryError).toBeUndefined();
    expect(updated.deliveryAttempts).toBe(1);
  });

  it("increments deliveryAttempts and stops retrying after MAX_DELIVERY_ATTEMPTS (Finding 7)", async () => {
    const store = openStore(":memory:");
    const wallet = "0x2bf7edf53bc6be6ff98f149387f3818ce28d2930";
    const chatId = 987654;
    const now = 1_000_000;

    const { code } = createLinkCode(store, wallet, now);
    consumeLinkCode(store, code, chatId, now + 1000);

    const alert: Alert = {
      id: "alert-failing",
      walletAddress: wallet,
      rule: "ghost",
      ticker: "GHOST",
      issuer: "ondo",
      severity: "critical",
      title: "GHOST token",
      body: "Ghost token.",
      evidence: { snapshotKind: "radar", snapshotKey: "0xghost", observedAt: now },
      createdAt: now,
      deliveryAttempts: MAX_DELIVERY_ATTEMPTS - 1, // 4 attempts already made
    };

    const warnings: string[] = [];
    const failingSender = {
      async sendMessage() {
        throw new Error(
          "Telegram API 400 Bad Request at https://api.telegram.org/botTOKEN/sendMessage",
        );
      },
    };

    // 5th attempt should be made and fail
    const res1 = await deliverPendingAlerts(failingSender, [alert], store, now + 2000, (w) =>
      warnings.push(w),
    );
    expect(res1.attempted).toBe(1);
    expect(res1.failed).toBe(1);
    const updatedAlert1 = res1.updatedAlerts[0]!;
    expect(updatedAlert1.deliveryAttempts).toBe(MAX_DELIVERY_ATTEMPTS); // now 5
    expect(updatedAlert1.lastDeliveryError).toContain("[redacted url]");
    expect(warnings.some((w) => w.includes("[redacted url]"))).toBe(true);

    // 6th run: since deliveryAttempts >= MAX_DELIVERY_ATTEMPTS, it should not even attempt delivery
    const res2 = await deliverPendingAlerts(failingSender, res1.updatedAlerts, store, now + 3000);
    expect(res2.attempted).toBe(0);
    expect(res2.delivered).toBe(0);
    expect(res2.failed).toBe(0);
    expect(res2.updatedAlerts[0]!.deliveryAttempts).toBe(MAX_DELIVERY_ATTEMPTS); // unchanged
  });
});
