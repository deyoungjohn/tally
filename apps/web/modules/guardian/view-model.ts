import {
  createLinkCode,
  DEFAULT_GUARDIAN_SETTINGS,
  getActiveLinkCodeForWallet,
  getLinkedChatForWallet,
  LINK_CODE_TTL_MS,
  type Alert,
  type AlertSeverity,
  type GuardianSettings,
  type Issuer,
  type QuietHours,
} from "@tally/mod-guardian";
import type { SnapshotStore } from "@tally/modkit";

export interface AlertFeedItemVM {
  id: string;
  rule: string;
  ticker: string;
  issuer: Issuer;
  severity: AlertSeverity;
  title: string;
  body: string;
  direction?: "min" | "max";
  evidence: {
    snapshotKind: string;
    snapshotKey: string;
    observedAt: number;
  };
  createdAt: number;
  createdAtFormatted: string;
}

export interface AlertFeedVM {
  state: "ready" | "empty" | "error";
  walletAddress: string | null;
  alerts: AlertFeedItemVM[];
  totalCount: number;
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  reason?: string | null;
  error: string | null;
  moduleDegraded?: boolean;
  moduleReason?: string | null;
}

export interface TelegramLinkVM {
  linked: boolean;
  chatId: number | string | null;
  alertsEnabled: boolean;
  quietHours?: QuietHours;
  activeLinkCode?: {
    code: string;
    expiresAt: number;
    expiresInSeconds: number;
  } | null;
}

export interface GuardianSettingsVM {
  state: "ready" | "empty" | "error";
  walletAddress: string | null;
  settings: GuardianSettings;
  telegram: TelegramLinkVM;
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  reason?: string | null;
  error: string | null;
  moduleDegraded?: boolean;
  moduleReason?: string | null;
}

export interface GuardianViewModel {
  state: "ready" | "empty" | "error";
  feed: AlertFeedVM;
  settings: GuardianSettingsVM;
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  reason?: string | null;
  error: string | null;
}

function formatAlertDate(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    });
  } catch {
    return new Date(timestamp).toISOString();
  }
}

/**
 * Loads the AlertFeedVM for a given wallet address.
 *
 * Invariant: The caller (WO-12 UI agent) MUST supply a verified session address
 * (e.g. from Privy server-side session authentication). Never pass an untrusted
 * user input or query string in production.
 */
export async function loadAlertFeed(opts?: {
  walletAddress?: string;
  store?: SnapshotStore;
  now?: number;
}): Promise<AlertFeedVM> {
  const wallet = opts?.walletAddress?.toLowerCase();
  const now = opts?.now ?? Date.now();

  if (!wallet) {
    return {
      state: "empty",
      walletAddress: null,
      alerts: [],
      totalCount: 0,
      stale: false,
      ageMs: null,
      source: null,
      reason: "Connect your wallet to view Guardian alerts.",
      error: null,
    };
  }

  if (!opts?.store) {
    return {
      state: "empty",
      walletAddress: wallet,
      alerts: [],
      totalCount: 0,
      stale: false,
      ageMs: null,
      source: null,
      reason: "No alert observations recorded yet.",
      error: null,
    };
  }

  // Kind "alerts" is protected by the prune job (EVIDENCE_SNAPSHOT_KINDS)
  const snap = opts.store.latest<Alert[]>("alerts", wallet, {
    maxAgeMs: 86_400_000,
    now,
  });

  if (!snap || !snap.data || snap.data.length === 0) {
    return {
      state: "empty",
      walletAddress: wallet,
      alerts: [],
      totalCount: 0,
      stale: snap?.stale ?? false,
      ageMs: snap?.ageMs ?? null,
      source: snap?.source ?? null,
      reason: "No alerts triggered for your holdings.",
      error: null,
    };
  }

  const items: AlertFeedItemVM[] = snap.data.map((alert) => ({
    id: alert.id,
    rule: alert.rule,
    ticker: alert.ticker,
    issuer: alert.issuer,
    severity: alert.severity,
    title: alert.title,
    body: alert.body,
    direction: alert.direction,
    evidence: alert.evidence,
    createdAt: alert.createdAt,
    createdAtFormatted: formatAlertDate(alert.createdAt),
  }));

  // Newest first
  items.sort((a, b) => b.createdAt - a.createdAt);

  return {
    state: "ready",
    walletAddress: wallet,
    alerts: items,
    totalCount: items.length,
    stale: snap.stale,
    ageMs: snap.ageMs,
    source: snap.source,
    reason: null,
    error: null,
  };
}

/**
 * Loads GuardianSettingsVM for a given wallet address.
 *
 * Invariant: The walletAddress MUST come from the verified Privy session.
 * One-time link codes are generated with crypto.randomInt and valid for 10 minutes.
 */
export async function loadGuardianSettings(opts?: {
  walletAddress?: string;
  store?: SnapshotStore;
  now?: number;
  issueNewLinkCode?: boolean;
}): Promise<GuardianSettingsVM> {
  const wallet = opts?.walletAddress?.toLowerCase();
  const now = opts?.now ?? Date.now();

  if (!wallet) {
    return {
      state: "empty",
      walletAddress: null,
      settings: DEFAULT_GUARDIAN_SETTINGS,
      telegram: {
        linked: false,
        chatId: null,
        alertsEnabled: false,
        activeLinkCode: null,
      },
      stale: false,
      ageMs: null,
      source: null,
      reason: "Connect your wallet to configure Guardian settings.",
      error: null,
    };
  }

  const store = opts?.store;
  let settings = DEFAULT_GUARDIAN_SETTINGS;
  let stale = false;
  let ageMs: number | null = null;
  let source: string | null = null;

  if (store) {
    const snap = store.latest<GuardianSettings>("guardian-settings", wallet, {
      maxAgeMs: 365 * 86_400_000,
      now,
    });
    if (snap?.data) {
      settings = snap.data;
      stale = snap.stale;
      ageMs = snap.ageMs;
      source = snap.source;
    }
  }

  // Telegram link status
  const telegram: TelegramLinkVM = {
    linked: false,
    chatId: null,
    alertsEnabled: false,
    activeLinkCode: null,
  };

  if (store) {
    const link = getLinkedChatForWallet(store, wallet, now);
    if (link) {
      telegram.linked = true;
      telegram.chatId = link.chatId;
      telegram.alertsEnabled = link.alertsEnabled;
      telegram.quietHours = link.quietHours;
    } else {
      // Find existing active link code or issue a new one if requested
      const activeCode = getActiveLinkCodeForWallet(store, wallet, now);

      if (activeCode) {
        telegram.activeLinkCode = {
          code: activeCode.code,
          expiresAt: activeCode.expiresAt,
          expiresInSeconds: Math.max(0, Math.round((activeCode.expiresAt - now) / 1000)),
        };
      } else if (opts?.issueNewLinkCode) {
        const { code, expiresAt } = createLinkCode(store, wallet, now);
        telegram.activeLinkCode = {
          code,
          expiresAt,
          expiresInSeconds: Math.round(LINK_CODE_TTL_MS / 1000),
        };
      }
    }
  }

  return {
    state: "ready",
    walletAddress: wallet,
    settings,
    telegram,
    stale,
    ageMs,
    source,
    reason: null,
    error: null,
  };
}

/**
 * Combined loader for the Guardian module (feed + settings).
 */
export async function loadGuardian(opts?: {
  walletAddress?: string;
  store?: SnapshotStore;
  now?: number;
  issueNewLinkCode?: boolean;
}): Promise<GuardianViewModel> {
  const [feed, settings] = await Promise.all([loadAlertFeed(opts), loadGuardianSettings(opts)]);

  const state = feed.state === "error" || settings.state === "error" ? "error" : "ready";
  const stale = feed.stale || settings.stale;
  const ageMs = Math.max(feed.ageMs ?? 0, settings.ageMs ?? 0) || null;
  const source = feed.source ?? settings.source;

  return {
    state,
    feed,
    settings,
    stale,
    ageMs,
    source,
    reason: feed.reason ?? settings.reason ?? null,
    error: feed.error ?? settings.error ?? null,
  };
}
