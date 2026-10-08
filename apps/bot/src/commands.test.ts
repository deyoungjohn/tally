import { beforeEach, describe, expect, it } from "vitest";
import { createFixtureEngine } from "@tally/engine";
import { createLinkCode, type Alert } from "@tally/mod-guardian";
import {
  openStore,
  type HealthRow,
  type JobName,
  type ModuleHealth,
  type SnapshotStore,
} from "@tally/modkit";
import { createBot, deliverPendingAlerts, verifyTelegramConfig } from "./bot";
import {
  adaptSharesReport,
  handleAlerts,
  handleLink,
  handleQuiet,
  handleQuote,
  handleShares,
  handleShield,
  handleStart,
  resetCommandRateLimits,
  type SharesHolding,
  type SharesOfPort,
  type SharesReport,
} from "./commands";

class MockHealth implements ModuleHealth {
  private rows = new Map<string, HealthRow>();

  report(module: JobName, result: { ok: boolean; error?: string; now?: number }): void {
    const now = result.now ?? Date.now();
    this.rows.set(module, {
      module,
      ok: result.ok,
      lastRunAt: now,
      lastOkAt: result.ok ? now : undefined,
      lastError: result.error,
    });
  }

  get(module: JobName): HealthRow | null {
    return this.rows.get(module) ?? null;
  }

  all(): HealthRow[] {
    return Array.from(this.rows.values());
  }
}

describe("Telegram Bot Commands (apps/bot)", () => {
  let store: SnapshotStore;
  const engine = createFixtureEngine();

  beforeEach(() => {
    resetCommandRateLimits();
    store = openStore(":memory:");
  });

  // Exit check 1: /quote NVDA 25 shows both issuers in shares with best tag
  it("quotes NVDA 25 comparing issuers in shares with BEST tag", async () => {
    const reply = await handleQuote("NVDA 25", {
      store,
      engine,
      chatId: 1001,
      now: () => 1_000_000,
    });

    expect(reply).toContain("NVDA Quote");
    expect(reply).toContain("ONDO");
    expect(reply).toContain("BSTOCK");
    expect(reply).toContain("Shares:");
    expect(reply).toContain("BEST");
    expect(reply).toContain("Price/share:");
    expect(reply).toContain("Grade");
  });

  // Exit check 2: /shares <address> on burner wallet
  it("replies that holdings are not available yet when sharesOf port is missing", async () => {
    const burner = "0xcb634955B8A7DF7B106f7AB47C9759B26206b777";
    const engineWithoutSharesOf = {
      ...engine,
      sharesOf: undefined,
    } as unknown as import("@tally/engine").Engine;
    const reply = await handleShares(burner, {
      store,
      engine: engineWithoutSharesOf,
      chatId: 1002,
      now: () => 1_000_000,
    });

    expect(reply).toBe("Holdings are not available yet.");
  });

  // Re-review 3 Finding 2: engine's own sharesOf is used when no port is injected
  it("uses engine's own sharesOf when no explicit port is injected", async () => {
    const burner = "0xcb634955B8A7DF7B106f7AB47C9759B26206b777";
    const reply = await handleShares(burner, {
      store,
      engine,
      chatId: 1002,
      now: () => 1_000_000,
    });

    expect(reply).toContain("Portfolio Holdings in Shares");
    expect(reply).toContain(burner);
    expect(reply).toContain("NVDA");
  });

  // Re-review 3 Finding 3: empty wallet prints scanned tickers notice
  it("prints scanned tickers notice when wallet has no holdings", async () => {
    const emptyWallet = "0x0000000000000000000000000000000000000001";
    const reply = await handleShares(emptyWallet, {
      store,
      engine,
      chatId: 1002,
      now: () => 1_000_000,
      sharesOf: async () => [
        {
          ticker: "NVDA",
          symbol: "NVDAon",
          issuer: "ondo",
          tokensRaw: 0n,
          sharesRaw: 0n,
        },
      ],
    });

    expect(reply).toContain(
      "No holdings found in the scanned tickers: NVDA, AAPL, TSLA, QQQ, SPY, NFLX",
    );
  });

  it("handles /shares on burner wallet address with injected fake sharesOf port", async () => {
    const burner = "0xcb634955B8A7DF7B106f7AB47C9759B26206b777";
    const reply = await handleShares(burner, {
      store,
      engine,
      chatId: 1002,
      now: () => 1_000_000,
      sharesOf: async (_addr) => [
        {
          ticker: "NVDA",
          symbol: "NVDAon",
          issuer: "ondo",
          tokensRaw: 10n * 10n ** 18n,
          sharesRaw: 10n * 10n ** 18n,
          multiplierRaw: 1n * 10n ** 18n,
          decimals: 18,
        },
      ],
    });

    expect(reply).toContain("Portfolio Holdings in Shares");
    expect(reply).toContain(burner);
    expect(reply).toContain("NVDA: 10 total shares");
  });

  // Orchestrator requirement: injected sharesOf(address) port with bigint holdings for arbitrary addresses
  it("handles /shares with injected sharesOf port using bigint maths for arbitrary address", async () => {
    const target = "0x9876543210987654321098765432109876543210";
    const fakeSharesOf: SharesOfPort = async (address: string): Promise<SharesHolding[]> => {
      expect(address).toBe(target);
      return [
        {
          ticker: "NVDA",
          symbol: "NVDAon",
          issuer: "ondo",
          tokensRaw: 10n * 10n ** 18n,
          sharesRaw: 100n * 10n ** 18n, // 10x multiplier
          multiplierRaw: 10n * 10n ** 18n,
          decimals: 18,
        },
        {
          ticker: "NVDA",
          symbol: "bNVDA",
          issuer: "bstock",
          tokensRaw: 5n * 10n ** 18n,
          sharesRaw: 5n * 10n ** 18n, // 1x multiplier
          multiplierRaw: 1n * 10n ** 18n,
          decimals: 18,
        },
        {
          ticker: "AAPL",
          symbol: "AAPLon",
          issuer: "ondo",
          tokensRaw: 2n * 10n ** 18n,
          sharesRaw: null, // multiplier unknown
          multiplierRaw: null,
          unavailableReason: "multiplier unknown, never 1:1",
          decimals: 18,
        },
      ];
    };

    const reply = await handleShares(target, {
      store,
      engine,
      chatId: 1003,
      now: () => 1_000_000,
      sharesOf: fakeSharesOf,
    });

    expect(reply).toContain("Portfolio Holdings in Shares");
    expect(reply).toContain(target);
    expect(reply).toContain("NVDA: 105 total shares");
    expect(reply).toContain("NVDAon (ONDO): 100 shares (10 tokens)");
    expect(reply).toContain("bNVDA (BSTOCK): 5 shares (5 tokens)");
    expect(reply).toContain("AAPLon (ONDO): shares unavailable (multiplier unknown, never 1:1)");
    expect(reply).not.toContain("2 shares"); // never defaults to 1:1
  });

  it("adapts SharesReport rows to SharesHolding[] cleanly", () => {
    const report: SharesReport = {
      rows: [
        {
          ticker: "NVDA",
          symbol: "NVDAon",
          issuer: "ondo",
          balance: 5n * 10n ** 18n,
          shares: 50n * 10n ** 18n,
          multiplier: 10n * 10n ** 18n,
          decimals: 18,
        },
        {
          ticker: "AAPL",
          symbol: "AAPLon",
          issuer: "ondo",
          balance: 2n * 10n ** 18n,
          shares: null,
          multiplier: null,
          reason: "unknown multiplier",
          decimals: 18,
        },
      ],
    };
    const holdings = adaptSharesReport(report);
    expect(holdings).toHaveLength(2);
    expect(holdings[0]?.sharesRaw).toBe(50n * 10n ** 18n);
    expect(holdings[1]?.sharesRaw).toBeNull();
    expect(holdings[1]?.unavailableReason).toBe("unknown multiplier");
  });

  // Exit check 3: /shield lists flagged tokens and shows staleness age
  it("lists flagged tokens on /shield and indicates snapshot age when stale", async () => {
    // Put a stale radar snapshot (15 minutes old) into store
    const now = 2_000_000;
    store.put({
      kind: "radar",
      key: "bsc",
      data: { asOf: new Date(now - 15 * 60_000).toISOString() },
      source: "radar",
      observedAt: now - 15 * 60_000,
    });

    const reply = await handleShield("NVDA", {
      store,
      engine,
      chatId: 1003,
      now: () => now,
    });

    expect(reply).toContain("Tally Trap Shield");
    expect(reply).toContain("Shield data observed 15m ago");
  });

  it("/shield without a ticker explains how to use it", async () => {
    const reply = await handleShield("", { store, engine, chatId: 1004, now: () => 1_000_000 });
    expect(reply).toContain("Usage: /shield &lt;TICKER&gt;");
    expect(reply).toContain("/shield NVDA");
  });

  // Exit check 4: Missing TELEGRAM_BOT_TOKEN gives clear error and unhealthy health row, not a crash
  it("reports unhealthy health row when TELEGRAM_BOT_TOKEN is missing without crashing", () => {
    const health = new MockHealth();
    const result = verifyTelegramConfig({}, health, 1_000_000);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Missing TELEGRAM_BOT_TOKEN");

    const row = health.get("guardian");
    expect(row?.ok).toBe(false);
    expect(row?.lastError).toContain("Missing TELEGRAM_BOT_TOKEN");
  });

  // Exit check 5: Failing sendMessage (mocked) leaves alert stored in snapshot store, reports error in health & onWarn
  it("preserves stored alerts in store when Telegram delivery fails", async () => {
    const now = 1_000_000;
    const wallet = "0x2bf7edf53bc6be6ff98f149387f3818ce28d2930";
    const chatId = 99999;

    // Link chat
    const { code } = createLinkCode(store, wallet, now);
    await handleLink(code, { store, engine, chatId, chatType: "private", now: () => now + 1000 });

    const alert: Alert = {
      id: `paused:${wallet}:0xnvdab:1000`,
      walletAddress: wallet,
      rule: "paused",
      ticker: "NVDA",
      issuer: "bstock",
      severity: "warning",
      title: "NVDA via bStock is paused",
      body: "NVDA via bStock is paused by its pause manager.",
      evidence: {
        snapshotKind: "status",
        snapshotKey: "0xnvdab",
        observedAt: now,
      },
      createdAt: now,
    };

    // Store alert in the store under kind "alerts"
    store.put({
      kind: "alerts",
      key: wallet,
      data: [alert],
      source: "guardian",
      observedAt: now,
    });

    const warnings: string[] = [];
    const mockSender = {
      async sendMessage() {
        throw new Error("Telegram API Network 502 Bad Gateway");
      },
    };

    const deliveryResult = await deliverPendingAlerts(mockSender, [alert], store, now + 2000, (w) =>
      warnings.push(w),
    );

    expect(deliveryResult.attempted).toBe(1);
    expect(deliveryResult.delivered).toBe(0);
    expect(deliveryResult.failed).toBe(1);
    expect(deliveryResult.errors[0]).toContain("Telegram API Network 502");
    expect(warnings.some((w) => w.includes("502 Bad Gateway"))).toBe(true);

    // CRITICAL: The alert is NOT deleted from the store
    const stored = store.latest<Alert[]>("alerts", wallet, { maxAgeMs: 60_000, now: now + 3000 });
    expect(stored?.data).toHaveLength(1);
    expect(stored?.data[0]?.id).toBe(alert.id);
  });

  // Input validations & minimum orders
  it("enforces $6 minimum order on /quote", async () => {
    const reply = await handleQuote("NVDA 5", {
      store,
      engine,
      chatId: 1005,
      now: () => 1_000_000,
    });
    expect(reply).toContain("Minimum order is $6");
  });

  it("returns clear error for unknown ticker on /quote", async () => {
    const reply = await handleQuote("UNKNOWNXYZ 25", {
      store,
      engine,
      chatId: 1006,
      now: () => 1_000_000,
    });
    expect(reply).toContain('Unknown ticker "UNKNOWNXYZ"');
  });

  it("validates 0x address format on /shares", async () => {
    const reply = await handleShares("notanaddress", {
      store,
      engine,
      chatId: 1007,
      now: () => 1_000_000,
    });
    expect(reply).toContain("Please provide a valid 0x wallet address");
  });

  // Rate limiting check
  it("limits commands to 5 per minute per chat", async () => {
    const chatId = 2001;
    const now = 1_000_000;

    for (let i = 0; i < 5; i++) {
      const reply = await handleQuote("NVDA 25", {
        store,
        engine,
        chatId,
        now: () => now + i * 1000,
      });
      expect(reply).toContain("NVDA Quote");
    }

    // 6th command in the same minute gets rate-limited
    const rateLimitedReply = await handleQuote("NVDA 25", {
      store,
      engine,
      chatId,
      now: () => now + 6000,
    });
    expect(rateLimitedReply).toContain("Rate limit reached");
  });

  // Link flow & quiet hours
  it("links wallet, toggles alerts, and configures quiet hours", async () => {
    const wallet = "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930";
    const chatId = 3001;
    const now = 1_000_000;

    const { code } = createLinkCode(store, wallet, now);
    const linkReply = await handleStart(code, {
      store,
      engine,
      chatId,
      chatType: "private",
      now: () => now + 5000,
    });
    expect(linkReply).toContain("Telegram linked to wallet");
    expect(linkReply).toContain(wallet.toLowerCase());

    // Toggle alerts off
    const offReply = await handleAlerts("off", {
      store,
      engine,
      chatId,
      now: () => now + 6000,
    });
    expect(offReply).toContain("turned OFF");

    // Toggle alerts on
    const onReply = await handleAlerts("on", {
      store,
      engine,
      chatId,
      now: () => now + 7000,
    });
    expect(onReply).toContain("turned ON");

    // Configure quiet hours 22-07 UTC
    const quietReply = await handleQuiet("22-07", {
      store,
      engine,
      chatId,
      now: () => now + 8000,
    });
    expect(quietReply).toContain("Quiet hours set to 22:00 - 07:00 UTC");

    // Test delivery suppression during quiet hours (e.g. at 23:30 UTC)
    // 2026-10-04T23:30:00Z = 1791156600000
    const quietNow = new Date("2026-10-04T23:30:00Z").getTime();
    const warningAlert: Alert = {
      id: `test:${wallet}:0xaddr:1`,
      walletAddress: wallet.toLowerCase(),
      rule: "ghost",
      ticker: "TSLA",
      issuer: "bstock",
      severity: "warning",
      title: "TSLA via bStock has low liquidity",
      body: "Liquidity is thin.",
      evidence: { snapshotKind: "flow-ghost", snapshotKey: "0xaddr", observedAt: quietNow },
      createdAt: quietNow,
    };

    const sent: string[] = [];
    const mockSender = {
      async sendMessage(_cid: number | string, text: string) {
        sent.push(text);
      },
    };

    // Warning alert is suppressed during quiet hours
    const deliv = await deliverPendingAlerts(mockSender, [warningAlert], store, quietNow);
    expect(deliv.suppressedByQuiet).toBe(1);
    expect(deliv.delivered).toBe(0);
    expect(sent).toHaveLength(0);

    // Critical alerts bypass quiet hours (Finding 7 & 12)
    const criticalAlert: Alert = {
      ...warningAlert,
      id: `test:${wallet}:0xaddr:2`,
      severity: "critical",
      title: "TSLA via bStock is a ghost token",
      body: "There's no market to sell this token.",
    };
    const critDeliv = await deliverPendingAlerts(mockSender, [criticalAlert], store, quietNow);
    expect(critDeliv.suppressedByQuiet).toBe(0);
    expect(critDeliv.delivered).toBe(1);
    expect(sent).toHaveLength(1);
  });

  // Finding 8: Never echo secrets or URLs in Telegram replies; redact in onWarn
  it("never echoes raw error or URL with secret in Telegram and redacts in onWarn (Finding 8)", async () => {
    const warnings: string[] = [];
    const crashingEngine = {
      quote: async () => {
        throw new Error("RPC failure at https://api.nodereal.io/v1/SECRET_API_KEY_12345");
      },
      portfolio: async () => ({ holdings: [] }),
    } as unknown as typeof engine;

    const reply = await handleQuote("NVDA 25", {
      store,
      engine: crashingEngine,
      chatId: 9999,
      now: () => 1_000_000,
      onWarn: (w) => warnings.push(w),
    });

    expect(reply).toBe("❌ Data is unavailable right now.");
    expect(reply).not.toContain("SECRET_API_KEY");
    expect(reply).not.toContain("nodereal");
    expect(warnings.some((w) => w.includes("[redacted url]"))).toBe(true);
    expect(warnings.some((w) => w.includes("SECRET_API_KEY"))).toBe(false);
  });

  // Finding 10: Linking allowed only in private direct messages
  it("rejects wallet linking in non-private chats (Finding 10)", async () => {
    const wallet = "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930";
    const { code } = createLinkCode(store, wallet, 1_000_000);

    const groupReply = await handleLink(code, {
      store,
      engine,
      chatId: -100123456,
      chatType: "group",
      now: () => 1_005_000,
    });

    expect(groupReply).toContain("only permitted in private direct messages");

    // Re-review 2 Finding 4: Fails closed when chatType is undefined
    const missingTypeReply = await handleLink(code, {
      store,
      engine,
      chatId: 100123456,
      now: () => 1_005_000,
    });
    expect(missingTypeReply).toContain("only permitted in private direct messages");
  });

  // Re-review 2 Finding 5: bot.catch logs redacted message
  it("bot.catch logs redacted error on unexpected handler failure", async () => {
    const warnings: string[] = [];
    const bot = createBot("123456:ABC-DEF_xyz789", {
      store,
      engine,
      onWarn: (msg) => warnings.push(msg),
    });

    // Invoke bot's error handler directly with an error containing secret url
    const fakeError = {
      error: new Error(
        "Unexpected failure at https://api.telegram.org/bot123456:ABC-DEF_xyz789/sendMessage",
      ),
      ctx: {} as unknown as import("grammy").Context,
    };
    // @ts-expect-error test internal error handler
    bot.errorHandler(fakeError);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Telegram bot handler error:");
    expect(warnings[0]).not.toContain("123456:ABC-DEF_xyz789");
    expect(warnings[0]).toContain("[redacted url]");
  });
});
