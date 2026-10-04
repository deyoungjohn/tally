import { describe, expect, it } from "vitest";
import type { Latest, Snapshot, SnapshotStore } from "@tally/modkit";
import type { GuardianLinkCodeData } from "./types";
import {
  consumeLinkCode,
  createLinkCode,
  generateLinkCode,
  getLinkedChatForWallet,
  getLinkedWalletForChat,
  LINK_CODE_ALPHABET,
  LINK_CODE_LENGTH,
  LINK_CODE_TTL_MS,
  MAX_LINK_ATTEMPTS,
  updateAlertsEnabledForChat,
  updateQuietHoursForChat,
} from "./link";

class MemorySnapshotStore implements SnapshotStore {
  private snapshots: Snapshot<unknown>[] = [];

  put<T>(snapshot: Snapshot<T>): void {
    this.snapshots.push(snapshot as Snapshot<unknown>);
  }

  latest<T>(kind: string, key: string, opts: { maxAgeMs: number; now?: number }): Latest<T> | null {
    const now = opts.now ?? Date.now();
    const matches = this.snapshots.filter((s) => s.kind === kind && s.key === key);
    if (matches.length === 0) return null;
    const latest = matches[matches.length - 1]!;
    const ageMs = Math.max(0, now - latest.observedAt);
    return {
      ...(latest as Snapshot<T>),
      ageMs,
      stale: ageMs > opts.maxAgeMs,
    };
  }

  history<T>(kind: string, key: string, sinceMs: number, limit = 50): Snapshot<T>[] {
    return this.snapshots
      .filter((s) => s.kind === kind && s.key === key && s.observedAt >= sinceMs)
      .slice(-limit) as Snapshot<T>[];
  }

  prune(): number {
    return 0;
  }
}

describe("Link Code Protocol (link.ts)", () => {
  it("generates unambiguous 8-character codes with no confusing glyphs (0/O/1/I/L)", () => {
    const code = generateLinkCode();
    expect(code).toHaveLength(LINK_CODE_LENGTH);
    for (const char of code) {
      expect(LINK_CODE_ALPHABET).toContain(char);
      expect(["0", "O", "1", "I", "L"]).not.toContain(char);
    }
  });

  it("creates active link code stored with issuedAt and 10-minute TTL", () => {
    const store = new MemorySnapshotStore();
    const now = 1_000_000;
    const { code, expiresAt } = createLinkCode(
      store,
      "0xAbC1234567890123456789012345678901234567",
      now,
    );

    expect(code).toHaveLength(LINK_CODE_LENGTH);
    expect(expiresAt).toBe(now + LINK_CODE_TTL_MS);

    const latest = store.latest<GuardianLinkCodeData>("guardian-link-code", code, {
      maxAgeMs: LINK_CODE_TTL_MS,
      now,
    });
    expect(latest?.data).toEqual({
      code,
      walletAddress: "0xabc1234567890123456789012345678901234567",
      issuedAt: now,
      expiresAt: now + LINK_CODE_TTL_MS,
      status: "active",
    });
  });

  it("consumes link code successfully and establishes bidirectional wallet <-> chat mapping", () => {
    const store = new MemorySnapshotStore();
    const now = 1_000_000;
    const { code } = createLinkCode(store, "0xWALLET1", now);

    const result = consumeLinkCode(store, code, 123456, now + 5000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.walletAddress).toBe("0xwallet1");
    expect(result.chatId).toBe(123456);

    // Wallet -> chat lookup
    const chatForWallet = getLinkedChatForWallet(store, "0xwallet1", now + 6000);
    expect(chatForWallet).toEqual({
      walletAddress: "0xwallet1",
      chatId: 123456,
      linkedAt: now + 5000,
      alertsEnabled: true,
    });

    // Chat -> wallet lookup
    const walletForChat = getLinkedWalletForChat(store, 123456, now + 6000);
    expect(walletForChat).toEqual({
      chatId: 123456,
      walletAddress: "0xwallet1",
      linkedAt: now + 5000,
      alertsEnabled: true,
    });
  });

  it("enforces single-use: rejecting reused link codes", () => {
    const store = new MemorySnapshotStore();
    const now = 1_000_000;
    const { code } = createLinkCode(store, "0xWALLET1", now);

    const first = consumeLinkCode(store, code, 123456, now + 1000);
    expect(first.ok).toBe(true);

    const second = consumeLinkCode(store, code, 999999, now + 2000);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toContain("already been used");
  });

  it("enforces 10-minute TTL against stored issuedAt", () => {
    const store = new MemorySnapshotStore();
    const now = 1_000_000;
    const { code } = createLinkCode(store, "0xWALLET1", now);

    // 10 minutes and 1 millisecond later
    const expiredResult = consumeLinkCode(store, code, 123456, now + LINK_CODE_TTL_MS + 1);
    expect(expiredResult.ok).toBe(false);
    if (expiredResult.ok) return;
    expect(expiredResult.error).toContain("expired");
  });

  it("rate limits chat after 5 failed attempts within 10 minutes", () => {
    const store = new MemorySnapshotStore();
    const now = 1_000_000;
    const chatId = 88888;

    // Fail 5 times with non-existent codes
    for (let i = 0; i < MAX_LINK_ATTEMPTS; i++) {
      const res = consumeLinkCode(store, `WRONG${i}XX`, chatId, now + i * 1000);
      expect(res.ok).toBe(false);
    }

    // 6th attempt should be rate limited immediately
    const rateLimitedRes = consumeLinkCode(store, "ANYVALID", chatId, now + 10_000);
    expect(rateLimitedRes.ok).toBe(false);
    if (rateLimitedRes.ok) return;
    expect(rateLimitedRes.rateLimited).toBe(true);
    expect(rateLimitedRes.error).toContain("Too many failed link attempts");
  });

  it("toggles alerts and updates quiet hours for linked chat", () => {
    const store = new MemorySnapshotStore();
    const now = 1_000_000;
    const { code } = createLinkCode(store, "0xWALLET1", now);
    consumeLinkCode(store, code, 123456, now + 1000);

    // Disable alerts
    expect(updateAlertsEnabledForChat(store, 123456, false, now + 2000)).toBe(true);
    expect(getLinkedWalletForChat(store, 123456, now + 3000)?.alertsEnabled).toBe(false);
    expect(getLinkedChatForWallet(store, "0xwallet1", now + 3000)?.alertsEnabled).toBe(false);

    // Update quiet hours
    const quiet = { enabled: true, startHourUtc: 23, endHourUtc: 8 };
    expect(updateQuietHoursForChat(store, 123456, quiet, now + 4000)).toBe(true);
    expect(getLinkedWalletForChat(store, 123456, now + 5000)?.quietHours).toEqual(quiet);
    expect(getLinkedChatForWallet(store, "0xwallet1", now + 5000)?.quietHours).toEqual(quiet);
  });
});
