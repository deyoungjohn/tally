import { randomInt } from "node:crypto";
import type { SnapshotStore } from "@tally/modkit";
import type { GuardianChatData, GuardianLinkCodeData, GuardianLinkData, QuietHours } from "./types";

/**
 * Unambiguous 30-character alphabet excluding easily confused glyphs:
 * 0, O (zero vs capital o) and 1, I, L (one vs capital I vs lower l).
 */
export const LINK_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const LINK_CODE_LENGTH = 8;
export const LINK_CODE_TTL_MS = 10 * 60_000; // 10 minutes
export const MAX_LINK_ATTEMPTS = 5;
export const LINK_ATTEMPT_WINDOW_MS = 10 * 60_000; // 10 minutes

/**
 * Generates a cryptographically secure, unambiguous one-time link code.
 * Uses crypto.randomInt (never Math.random).
 * NEVER log the generated code.
 */
export function generateLinkCode(length = LINK_CODE_LENGTH): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    const idx = randomInt(0, LINK_CODE_ALPHABET.length);
    code += LINK_CODE_ALPHABET[idx];
  }
  return code;
}

/**
 * Issues a new one-time link code for a verified wallet address.
 * The address MUST come from a verified session (e.g. Privy session), never
 * from an unauthenticated request body or query string.
 *
 * Stored under snapshot kind "guardian-link-code" with key = code.
 * Note: The bot is a single process. That is what makes read-then-write safe.
 */
export function createLinkCode(
  store: SnapshotStore,
  walletAddress: string,
  now = Date.now(),
): { code: string; expiresAt: number } {
  const code = generateLinkCode();
  const expiresAt = now + LINK_CODE_TTL_MS;
  const normalizedWallet = walletAddress.toLowerCase();

  // Revoke previous active link code for this wallet if one exists (Finding 12)
  const prevActiveSnap = store.latest<GuardianLinkCodeData>(
    "guardian-active-code",
    normalizedWallet,
    {
      maxAgeMs: LINK_CODE_TTL_MS * 2,
      now,
    },
  );
  if (prevActiveSnap?.data && prevActiveSnap.data.status === "active") {
    store.put({
      kind: "guardian-link-code",
      key: prevActiveSnap.data.code,
      data: {
        ...prevActiveSnap.data,
        status: "consumed",
        consumedAt: now,
      },
      source: "guardian-link",
      observedAt: now,
    });
  }

  const record: GuardianLinkCodeData = {
    code,
    walletAddress: normalizedWallet,
    issuedAt: now,
    expiresAt,
    status: "active",
  };

  store.put({
    kind: "guardian-link-code",
    key: code,
    data: record,
    source: "guardian-link",
    observedAt: now,
  });

  store.put({
    kind: "guardian-active-code",
    key: normalizedWallet,
    data: record,
    source: "guardian-link",
    observedAt: now,
  });

  return { code, expiresAt };
}

export type ConsumeLinkCodeResult =
  | { ok: true; walletAddress: string; chatId: number | string }
  | { ok: false; error: string; rateLimited?: boolean };

/**
 * Consumes a one-time link code sent by a Telegram user in chat.
 *
 * Security and protocol invariants:
 * 1. Rate limiting: Chat is allowed max 5 failed attempts per 10 minutes.
 * 2. TTL: Enforced against the stored `issuedAt` (not snapshot observedAt).
 * 3. Single-use: Consuming writes a newer record with status: "consumed",
 *    and the latest record always wins.
 * 4. Bidirectional mapping: Writes both wallet -> chat and chat -> wallet.
 * 5. Single process: The bot runs as a single process, making read-then-write safe.
 */
export function consumeLinkCode(
  store: SnapshotStore,
  rawCode: string,
  chatId: number | string,
  now = Date.now(),
): ConsumeLinkCodeResult {
  const chatKey = String(chatId);

  // 1. Rate limiting check (max 5 failed attempts per 10m)
  const since = now - LINK_ATTEMPT_WINDOW_MS;
  const failedAttempts = store.history<{ attemptAt: number }>(
    "guardian-link-attempt",
    chatKey,
    since,
  );
  if (failedAttempts.length >= MAX_LINK_ATTEMPTS) {
    return {
      ok: false,
      error: "Too many failed link attempts. Please wait 10 minutes before trying again.",
      rateLimited: true,
    };
  }

  const recordFailedAttempt = () => {
    store.put({
      kind: "guardian-link-attempt",
      key: chatKey,
      data: { attemptAt: now },
      source: "guardian-link",
      observedAt: now,
    });
  };

  const code = rawCode.trim().toUpperCase();
  if (code.length < LINK_CODE_LENGTH) {
    recordFailedAttempt();
    return {
      ok: false,
      error: "Invalid link code. Code must be at least 8 characters.",
    };
  }

  // 2. Query latest link code record
  const latestSnap = store.latest<GuardianLinkCodeData>("guardian-link-code", code, {
    maxAgeMs: LINK_CODE_TTL_MS * 2, // Query with room so we can distinguish expired vs missing
    now,
  });

  if (!latestSnap?.data) {
    recordFailedAttempt();
    return {
      ok: false,
      error: "Link code not found. Please generate a new code in the web app.",
    };
  }

  const codeData = latestSnap.data;

  // 3. Single-use check
  if (codeData.status === "consumed") {
    recordFailedAttempt();
    return {
      ok: false,
      error: "This link code has already been used. Please generate a new code in the web app.",
    };
  }

  // 4. TTL check against issuedAt
  if (now - codeData.issuedAt > LINK_CODE_TTL_MS) {
    recordFailedAttempt();
    return {
      ok: false,
      error: "This link code has expired. Link codes are valid for 10 minutes.",
    };
  }

  // 5. Success: Consume the code and write updated row (latest wins)
  const consumedRecord: GuardianLinkCodeData = {
    ...codeData,
    status: "consumed",
    consumedAt: now,
    chatId,
  };

  store.put({
    kind: "guardian-link-code",
    key: code,
    data: consumedRecord,
    source: "guardian-link",
    observedAt: now,
  });

  store.put({
    kind: "guardian-active-code",
    key: codeData.walletAddress,
    data: consumedRecord,
    source: "guardian-link",
    observedAt: now,
  });

  // Write wallet -> chat link
  const linkData: GuardianLinkData = {
    walletAddress: codeData.walletAddress,
    chatId,
    linkedAt: now,
    alertsEnabled: true,
  };

  store.put({
    kind: "guardian-link",
    key: codeData.walletAddress,
    data: linkData,
    source: "guardian-link",
    observedAt: now,
  });

  // Write chat -> wallet link
  const chatData: GuardianChatData = {
    chatId,
    walletAddress: codeData.walletAddress,
    linkedAt: now,
    alertsEnabled: true,
  };

  store.put({
    kind: "guardian-chat",
    key: chatKey,
    data: chatData,
    source: "guardian-link",
    observedAt: now,
  });

  // Write active wallet entry for background workers/jobs discovery (Finding 4)
  store.put({
    kind: "wallet:active",
    key: "bsc",
    data: { address: codeData.walletAddress },
    source: "guardian-link",
    observedAt: now,
  });

  return {
    ok: true,
    walletAddress: codeData.walletAddress,
    chatId,
  };
}

/**
 * Retrieves the currently active link code for a given wallet address, if any.
 */
export function getActiveLinkCodeForWallet(
  store: SnapshotStore,
  walletAddress: string,
  now = Date.now(),
): GuardianLinkCodeData | null {
  const snap = store.latest<GuardianLinkCodeData>(
    "guardian-active-code",
    walletAddress.toLowerCase(),
    { maxAgeMs: LINK_CODE_TTL_MS, now },
  );
  if (snap?.data && snap.data.status === "active" && now - snap.data.issuedAt < LINK_CODE_TTL_MS) {
    return snap.data;
  }
  return null;
}

/**
 * Retrieves the linked Telegram chat for a given wallet address.
 */
export function getLinkedChatForWallet(
  store: SnapshotStore,
  walletAddress: string,
  now = Date.now(),
): GuardianLinkData | null {
  const snap = store.latest<GuardianLinkData>("guardian-link", walletAddress.toLowerCase(), {
    maxAgeMs: 365 * 86_400_000,
    now,
  });
  return snap?.data ?? null;
}

/**
 * Retrieves the linked wallet address for a given Telegram chat ID.
 */
export function getLinkedWalletForChat(
  store: SnapshotStore,
  chatId: number | string,
  now = Date.now(),
): GuardianChatData | null {
  const snap = store.latest<GuardianChatData>("guardian-chat", String(chatId), {
    maxAgeMs: 365 * 86_400_000,
    now,
  });
  return snap?.data ?? null;
}

/**
 * Updates alert notification toggle for a chat.
 */
export function updateAlertsEnabledForChat(
  store: SnapshotStore,
  chatId: number | string,
  alertsEnabled: boolean,
  now = Date.now(),
): boolean {
  const existing = getLinkedWalletForChat(store, chatId, now);
  if (!existing) return false;

  const chatKey = String(chatId);
  const updatedChat: GuardianChatData = {
    ...existing,
    alertsEnabled,
  };

  store.put({
    kind: "guardian-chat",
    key: chatKey,
    data: updatedChat,
    source: "guardian-bot",
    observedAt: now,
  });

  const existingWallet = getLinkedChatForWallet(store, existing.walletAddress, now);
  if (existingWallet) {
    store.put({
      kind: "guardian-link",
      key: existing.walletAddress,
      data: {
        ...existingWallet,
        alertsEnabled,
      },
      source: "guardian-bot",
      observedAt: now,
    });
  }

  return true;
}

/**
 * Updates quiet hours settings for a chat.
 */
export function updateQuietHoursForChat(
  store: SnapshotStore,
  chatId: number | string,
  quietHours: QuietHours,
  now = Date.now(),
): boolean {
  const existing = getLinkedWalletForChat(store, chatId, now);
  if (!existing) return false;

  const chatKey = String(chatId);
  const updatedChat: GuardianChatData = {
    ...existing,
    quietHours,
  };

  store.put({
    kind: "guardian-chat",
    key: chatKey,
    data: updatedChat,
    source: "guardian-bot",
    observedAt: now,
  });

  const existingWallet = getLinkedChatForWallet(store, existing.walletAddress, now);
  if (existingWallet) {
    store.put({
      kind: "guardian-link",
      key: existing.walletAddress,
      data: {
        ...existingWallet,
        quietHours,
      },
      source: "guardian-bot",
      observedAt: now,
    });
  }

  return true;
}
