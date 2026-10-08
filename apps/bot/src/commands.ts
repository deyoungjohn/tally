import { formatUnits } from "@tally/core";
import type { Engine } from "@tally/engine";
import {
  consumeLinkCode,
  getLinkedWalletForChat,
  updateAlertsEnabledForChat,
  updateQuietHoursForChat,
} from "@tally/mod-guardian";
import type { QuietHours } from "@tally/mod-guardian";
import type { SnapshotStore } from "@tally/modkit";

export interface SharesHolding {
  ticker: string;
  symbol: string;
  issuer: string;
  tokenAddress?: string;
  tokensRaw: bigint;
  /** 1e18 fixed-point shares, or null if multiplier unknown */
  sharesRaw: bigint | null;
  multiplierRaw?: bigint | null;
  unavailableReason?: string;
  decimals?: number;
}

export interface SharesReportRow {
  ticker: string;
  symbol: string;
  issuer: string;
  tokenAddress?: string;
  balance: bigint;
  shares: bigint | null;
  multiplier?: bigint | null;
  reason?: string;
  decimals?: number;
}

export interface SharesReport {
  rows: SharesReportRow[];
  groups?: Array<{
    ticker: string;
    shares: bigint | null;
    rows: SharesReportRow[];
  }>;
}

export type SharesOfPort = (address: string) => Promise<SharesReport | SharesHolding[] | unknown>;

/** Redacts URLs and potential credentials from error strings (Finding 8 & Finding 6) */
export function redactSecrets(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted url]")
    .replace(/bot\d+:[A-Za-z0-9_-]+/gi, "[redacted token]");
}

/** Adapts WO-05 SharesReport or raw SharesHolding[] into handler shape (Finding 9) */
export function adaptSharesReport(data: unknown): SharesHolding[] {
  if (Array.isArray(data)) {
    return data as SharesHolding[];
  }
  if (
    data &&
    typeof data === "object" &&
    "rows" in data &&
    Array.isArray((data as { rows: unknown[] }).rows)
  ) {
    const report = data as SharesReport;
    return report.rows.map((r) => ({
      ticker: r.ticker,
      symbol: r.symbol,
      issuer: r.issuer,
      tokenAddress: r.tokenAddress,
      tokensRaw: r.balance,
      sharesRaw: r.shares,
      multiplierRaw: r.multiplier ?? null,
      unavailableReason: r.reason,
      decimals: r.decimals ?? 18,
    }));
  }
  return [];
}

export interface BotContext {
  store: SnapshotStore;
  engine: Engine;
  now?: () => number;
  chatId: number | string;
  chatType?: string;
  text?: string;
  onWarn?: (message: string) => void;
  /** Injected port for reading holdings in bigint 1e18 shares for arbitrary addresses (wires to WO-05 engine.sharesOf once merged) */
  sharesOf?: SharesOfPort;
}

/** In-memory rate limiting: max 5 commands per minute per chat */
const COMMAND_RATE_LIMIT = 5;
const COMMAND_WINDOW_MS = 60_000;
const chatCommandTimestamps = new Map<string, number[]>();

export function checkCommandRateLimit(chatId: number | string, now: number): boolean {
  const key = String(chatId);
  const timestamps = (chatCommandTimestamps.get(key) ?? []).filter(
    (t) => now - t < COMMAND_WINDOW_MS,
  );
  if (timestamps.length >= COMMAND_RATE_LIMIT) {
    return false;
  }
  timestamps.push(now);
  chatCommandTimestamps.set(key, timestamps);
  return true;
}

/** Resets rate limits (useful for testing) */
export function resetCommandRateLimits(): void {
  chatCommandTimestamps.clear();
}

/** Validates Ethereum / BSC hex address */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function handleHelp(): string {
  return [
    "🛡️ <b>Tally Guardian Bot Commands</b>",
    "",
    "<code>/quote &lt;TICKER&gt; [usd]</code> - Compare issuers in shares (default $25, min $6)",
    "<code>/shares &lt;0xaddress&gt;</code> - Portfolio holdings in shares across issuers",
    "<code>/shield</code> - Flagged tokens, traps and integrity grades",
    "<code>/link &lt;CODE&gt;</code> - Link your Telegram to your Tally wallet",
    "<code>/unlink</code> - Unlink your Tally wallet and stop alerts",
    "<code>/alerts on|off</code> - Turn Guardian alert notifications on or off",
    "<code>/quiet &lt;start&gt;-&lt;end&gt;</code> - Set quiet hours in UTC (e.g. <code>/quiet 22-07</code>) or <code>/quiet off</code>",
    "<code>/help</code> - Show this help message",
  ].join("\n");
}

export async function handleStart(args: string, ctx: BotContext): Promise<string> {
  const code = args.trim();
  if (code) {
    return handleLink(code, ctx);
  }

  const now = ctx.now ? ctx.now() : Date.now();
  const linked = getLinkedWalletForChat(ctx.store, ctx.chatId, now);

  const lines = [
    "👋 Welcome to Tally Guardian",
    "",
    "Watch over what you hold on BNB Chain with share-true data.",
    "",
  ];

  if (linked) {
    lines.push(
      `✅ Linked to wallet <code>${linked.walletAddress}</code>.`,
      `Alerts: ${linked.alertsEnabled ? "ON" : "OFF"}`,
      "",
    );
  } else {
    lines.push(
      "To receive alerts for your holdings, connect your wallet in the Tally web app and send:",
      "<code>/link &lt;CODE&gt;</code>",
      "",
    );
  }

  lines.push(
    "Commands:",
    "• <code>/quote &lt;TICKER&gt; [usd]</code> - Compare issuers in shares",
    "• <code>/shares &lt;0xaddress&gt;</code> - Holdings in shares",
    "• <code>/shield</code> - View flagged tokens & integrity traps",
    "• <code>/alerts on|off</code> - Manage alert delivery",
    "• <code>/quiet 22-07</code> - Configure quiet hours (UTC)",
    "• <code>/help</code> - Command guide",
  );

  return lines.join("\n");
}

export async function handleLink(args: string, ctx: BotContext): Promise<string> {
  if (ctx.chatType !== "private") {
    return "❌ Linking your wallet is only permitted in private direct messages with the bot.";
  }

  const code = args.trim();
  if (!code) {
    return [
      "Usage: <code>/link &lt;CODE&gt;</code>",
      "",
      "Generate an 8-character link code in the Tally web app under Guardian settings.",
    ].join("\n");
  }

  const now = ctx.now ? ctx.now() : Date.now();
  const result = consumeLinkCode(ctx.store, code, ctx.chatId, now);

  if (!result.ok) {
    return `❌ ${result.error}`;
  }

  return [
    `✅ Telegram linked to wallet <code>${result.walletAddress}</code>!`,
    "",
    "You will now receive Guardian alerts for your holdings here.",
    "",
    "Commands:",
    "• <code>/alerts on|off</code> - Enable or mute alerts",
    "• <code>/quiet 22-07</code> - Set quiet hours window (UTC)",
  ].join("\n");
}

export async function handleUnlink(ctx: BotContext): Promise<string> {
  if (ctx.chatType !== "private") {
    return "❌ Unlinking your wallet is only permitted in private direct messages with the bot.";
  }

  const { unlinkChat } = await import("@tally/mod-guardian");
  const now = ctx.now ? ctx.now() : Date.now();
  const walletAddress = unlinkChat(ctx.store, ctx.chatId, now);

  if (!walletAddress) {
    return "❌ Your Telegram account is not linked to any wallet.";
  }

  return `✅ Unlinked from wallet <code>${walletAddress}</code>. You will get no more alerts. Send /link CODE to link again.`;
}

export async function handleAlerts(args: string, ctx: BotContext): Promise<string> {
  const now = ctx.now ? ctx.now() : Date.now();
  const linked = getLinkedWalletForChat(ctx.store, ctx.chatId, now);
  if (!linked) {
    return "⚠️ Your Telegram is not linked to a wallet yet. Send <code>/link &lt;CODE&gt;</code> first.";
  }

  const mode = args.trim().toLowerCase();
  if (mode === "on") {
    updateAlertsEnabledForChat(ctx.store, ctx.chatId, true, now);
    return "🔔 Guardian alerts turned ON.";
  }

  if (mode === "off") {
    updateAlertsEnabledForChat(ctx.store, ctx.chatId, false, now);
    return "🔕 Guardian alerts turned OFF.";
  }

  return `Guardian alerts are currently ${linked.alertsEnabled ? "ON" : "OFF"}. Use <code>/alerts on</code> or <code>/alerts off</code>.`;
}

export async function handleQuiet(args: string, ctx: BotContext): Promise<string> {
  const now = ctx.now ? ctx.now() : Date.now();
  const linked = getLinkedWalletForChat(ctx.store, ctx.chatId, now);
  if (!linked) {
    return "⚠️ Your Telegram is not linked to a wallet yet. Send <code>/link &lt;CODE&gt;</code> first.";
  }

  const input = args.trim().toLowerCase();
  if (input === "off") {
    const quiet: QuietHours = { enabled: false, startHourUtc: 22, endHourUtc: 7 };
    updateQuietHoursForChat(ctx.store, ctx.chatId, quiet, now);
    return "✅ Quiet hours turned OFF.";
  }

  const match = /^(\d{1,2})-(\d{1,2})$/.exec(input);
  if (!match) {
    return "Usage: <code>/quiet 22-07</code> (UTC start-end hours, 0-23) or <code>/quiet off</code>";
  }

  const startHourUtc = Number.parseInt(match[1]!, 10);
  const endHourUtc = Number.parseInt(match[2]!, 10);

  if (startHourUtc < 0 || startHourUtc > 23 || endHourUtc < 0 || endHourUtc > 23) {
    return "❌ Invalid hours. Please provide hours from 0 to 23 (e.g. <code>/quiet 22-07</code>).";
  }

  const quiet: QuietHours = {
    enabled: true,
    startHourUtc,
    endHourUtc,
  };

  updateQuietHoursForChat(ctx.store, ctx.chatId, quiet, now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `🌙 Quiet hours set to ${pad(startHourUtc)}:00 - ${pad(endHourUtc)}:00 UTC.\nAlerts received during this window will be delivered once quiet hours end.`;
}

export async function handleQuote(args: string, ctx: BotContext): Promise<string> {
  const now = ctx.now ? ctx.now() : Date.now();
  if (!checkCommandRateLimit(ctx.chatId, now)) {
    return "⏳ Rate limit reached. You can run up to 5 commands per minute. Please wait a moment.";
  }

  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "Usage: <code>/quote &lt;TICKER&gt; [usd]</code>\nExample: <code>/quote NVDA 25</code>";
  }

  const ticker = parts[0]!.toUpperCase();
  const usdAmount = parts[1] ? Number.parseFloat(parts[1]) : 25;

  if (Number.isNaN(usdAmount) || usdAmount <= 0) {
    return "❌ Invalid amount. Example: <code>/quote NVDA 25</code>";
  }

  if (usdAmount < 6) {
    return "❌ Minimum order is $6 (got $" + usdAmount + ").";
  }

  try {
    const quote = await ctx.engine.quote({
      ticker,
      amount: { usd: usdAmount },
    });

    const lines: string[] = [
      `📊 <b>${quote.ticker} Quote</b> ($${usdAmount} USDT order)`,
      `Session: ${quote.session}`,
      "",
    ];

    if (quote.rows.length === 0) {
      lines.push("No quote routes available for this ticker right now.");
    }

    for (const row of quote.rows) {
      const isBest = row.isBest ? " ⭐ BEST" : "";
      const issuer = row.issuer.toUpperCase();
      lines.push(`<b>${row.symbol}</b> (${issuer})${isBest}`);

      if (!row.multiplier) {
        lines.push("  • Shares: <code>null</code> (multiplier unknown, never 1:1)");
      } else if (row.sharesOut !== undefined) {
        lines.push(`  • Shares: <code>${formatUnits(row.sharesOut, row.decimals, 4)}</code>`);
      }

      if (row.usdPerShare !== undefined) {
        lines.push(`  • Price/share: <code>$${row.usdPerShare.toFixed(2)}</code>`);
      }

      if (row.premium !== undefined) {
        const sign = row.premium >= 0 ? "+" : "";
        lines.push(`  • Premium vs US: <code>${sign}${(row.premium * 100).toFixed(2)}%</code>`);
      }

      if (row.feeUsd !== undefined) {
        lines.push(`  • Network fee: <code>~$${row.feeUsd.toFixed(2)}</code>`);
      }

      lines.push(`  • Integrity: Grade ${row.integrity.grade}`);

      if (row.notExecutableReason) {
        lines.push(`  • Note: ${row.notExecutableReason}`);
      }
      lines.push("");
    }

    return lines.join("\n").trim();
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    if (rawMsg.includes("Unknown ticker") || rawMsg.includes("not found")) {
      return `❌ Unknown ticker "${ticker}" on BNB Chain.`;
    }
    ctx.onWarn?.(`Quote error: ${redactSecrets(rawMsg)}`);
    return "❌ Data is unavailable right now.";
  }
}

async function getKnownTickers(ctx: BotContext): Promise<string[]> {
  const regSnap = ctx.store.latest<Array<{ underlyingTicker?: string }>>("registry", "bsc", {
    maxAgeMs: 86_400_000,
    now: ctx.now ? ctx.now() : Date.now(),
  });
  if (regSnap?.data && Array.isArray(regSnap.data) && regSnap.data.length > 0) {
    const set = new Set<string>();
    for (const r of regSnap.data) {
      if (r.underlyingTicker) set.add(r.underlyingTicker.toUpperCase());
    }
    if (set.size > 0) return Array.from(set);
  }
  try {
    const list = await ctx.engine.collectors.registry();
    const set = new Set<string>();
    for (const r of list) {
      if (r.underlyingTicker) set.add(r.underlyingTicker.toUpperCase());
    }
    if (set.size > 0) return Array.from(set);
  } catch {
    // fallback
  }
  return ["NVDA", "AAPL", "TSLA", "QQQ", "SPY", "NFLX"];
}

export async function handleShares(
  args: string,
  ctx: BotContext,
  sharesOfPort?: SharesOfPort,
): Promise<string> {
  const now = ctx.now ? ctx.now() : Date.now();
  if (!checkCommandRateLimit(ctx.chatId, now)) {
    return "⏳ Rate limit reached. You can run up to 5 commands per minute. Please wait a moment.";
  }

  const address = args.trim();
  if (!address || !isValidAddress(address)) {
    return "❌ Please provide a valid 0x wallet address: <code>/shares 0x...</code>";
  }

  const port =
    sharesOfPort ?? ctx.sharesOf ?? (ctx.engine as unknown as { sharesOf?: SharesOfPort }).sharesOf;

  if (typeof port !== "function") {
    return "Holdings are not available yet.";
  }

  try {
    const rawResult = await port(address);
    const holdings = adaptSharesReport(rawResult);
    const lines: string[] = [
      `💼 Portfolio Holdings in Shares`,
      `Wallet: <code>${address}</code>`,
      "",
    ];

    // Re-review 3 Finding 3: Show only rows with a balance or a reason; when nothing is held, print scanned tickers
    const activeHoldings = holdings.filter(
      (it) =>
        it.tokensRaw > 0n ||
        (it.sharesRaw !== null && it.sharesRaw > 0n) ||
        Boolean(it.unavailableReason),
    );

    if (activeHoldings.length === 0) {
      lines.push("No holdings found in the scanned tickers: NVDA, AAPL, TSLA, QQQ, SPY, NFLX");
      return lines.join("\n");
    }

    // Group holdings by underlying ticker
    const byTicker = new Map<string, SharesHolding[]>();
    for (const h of activeHoldings) {
      const list = byTicker.get(h.ticker) ?? [];
      list.push(h);
      byTicker.set(h.ticker, list);
    }

    for (const [ticker, items] of byTicker.entries()) {
      const knownShares = items.filter(
        (it): it is SharesHolding & { sharesRaw: bigint } => it.sharesRaw !== null,
      );
      const totalSharesRaw = knownShares.reduce((acc, it) => acc + it.sharesRaw, 0n);
      const hasUnknown = items.some((it) => it.sharesRaw === null);

      const totalStr = hasUnknown
        ? `${formatUnits(totalSharesRaw, 18, 4)}* (some issuers unavailable)`
        : `${formatUnits(totalSharesRaw, 18, 4)} total shares`;

      lines.push(`${ticker}: ${totalStr}`);

      for (const it of items) {
        const issuerStr = it.issuer.toUpperCase();
        if (it.sharesRaw === null) {
          lines.push(
            `  • ${it.symbol} (${issuerStr}): shares unavailable (${it.unavailableReason ?? "multiplier unknown, never 1:1"})`,
          );
        } else {
          const dec = it.decimals ?? 18;
          lines.push(
            `  • ${it.symbol} (${issuerStr}): ${formatUnits(it.sharesRaw, 18, 4)} shares (${formatUnits(it.tokensRaw, dec, 4)} tokens)`,
          );
        }
      }
      lines.push("");
    }

    return lines.join("\n").trim();
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    ctx.onWarn?.(`Shares error: ${redactSecrets(rawMsg)}`);
    return "❌ Data is unavailable right now.";
  }
}

export async function handleShield(args: string, ctx: BotContext): Promise<string> {
  const now = ctx.now ? ctx.now() : Date.now();
  if (!checkCommandRateLimit(ctx.chatId, now)) {
    return "⏳ Rate limit reached. You can run up to 5 commands per minute. Please wait a moment.";
  }

  try {
    // Check if radar snapshot exists in store to check freshness
    const radarSnap = ctx.store.latest<{ asOf: string }>("radar", "bsc", {
      maxAgeMs: 600_000,
      now,
    });
    const isStale = radarSnap?.stale ?? false;
    const ageMs = radarSnap?.ageMs ?? 0;

    const tickers = await getKnownTickers(ctx);
    const report = await ctx.engine.radar(tickers);
    const flagged = report.rows.filter(
      (r) =>
        r.grade === "D" ||
        r.grade === "F" ||
        r.unitTrap ||
        r.status === "paused" ||
        (r.flags && r.flags.length > 0) ||
        !r.executable,
    );

    const lines: string[] = ["🛡️ Tally Trap Shield - Flagged Tokens", ""];

    if (flagged.length === 0) {
      lines.push("✅ No flagged tokens or traps detected on BNB Chain right now.");
    } else {
      for (const row of flagged) {
        const issuer = row.issuer.toUpperCase();
        lines.push(`${row.ticker} (${row.symbol} · ${issuer}) - Grade ${row.grade}`);
        if (row.reason) {
          lines.push(`  • Reason: ${row.reason}`);
        }
        if (row.reasons && row.reasons.length > 0) {
          for (const reason of row.reasons) {
            lines.push(`  • ${reason}`);
          }
        }
        if (row.unitTrap) {
          lines.push("  • ⚠️ Unit mismatch trap (token count does not equal share count)");
        }
        lines.push("");
      }
    }

    if (isStale && ageMs > 0) {
      const mins = Math.round(ageMs / 60_000);
      lines.push(`(Note: Shield data observed ${mins}m ago)`);
    }

    return lines.join("\n").trim();
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    ctx.onWarn?.(`Shield error: ${redactSecrets(rawMsg)}`);
    return "❌ Data is unavailable right now.";
  }
}
