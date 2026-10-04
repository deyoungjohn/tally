import { Bot } from "grammy";
import type { Engine } from "@tally/engine";
import { isQuietHours, type Alert, type GuardianLinkData } from "@tally/mod-guardian";
import type { ModuleHealth, SnapshotStore } from "@tally/modkit";
import {
  handleAlerts,
  handleHelp,
  handleLink,
  handleQuiet,
  handleQuote,
  handleShares,
  handleShield,
  handleStart,
  type SharesOfPort,
} from "./commands";

export interface BotDependencies {
  store: SnapshotStore;
  engine: Engine;
  sharesOf?: SharesOfPort;
  health?: ModuleHealth;
  onWarn?: (message: string) => void;
  now?: () => number;
}

/**
 * Creates and configures a grammY Bot instance with read-only commands.
 * NEVER log the bot token.
 */
export function createBot(token: string, deps: BotDependencies): Bot {
  if (!token || typeof token !== "string" || token.trim() === "") {
    throw new Error("Cannot create Telegram bot: invalid or missing token");
  }

  const bot = new Bot(token);
  const now = deps.now ?? Date.now;

  bot.command("start", async (ctx) => {
    const text = await handleStart(ctx.match ?? "", {
      store: deps.store,
      engine: deps.engine,
      chatId: ctx.chat.id,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  bot.command("link", async (ctx) => {
    const text = await handleLink(ctx.match ?? "", {
      store: deps.store,
      engine: deps.engine,
      chatId: ctx.chat.id,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  bot.command("alerts", async (ctx) => {
    const text = await handleAlerts(ctx.match ?? "", {
      store: deps.store,
      engine: deps.engine,
      chatId: ctx.chat.id,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  bot.command("quiet", async (ctx) => {
    const text = await handleQuiet(ctx.match ?? "", {
      store: deps.store,
      engine: deps.engine,
      chatId: ctx.chat.id,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  bot.command("quote", async (ctx) => {
    const text = await handleQuote(ctx.match ?? "", {
      store: deps.store,
      engine: deps.engine,
      chatId: ctx.chat.id,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  bot.command("shares", async (ctx) => {
    const text = await handleShares(ctx.match ?? "", {
      store: deps.store,
      engine: deps.engine,
      sharesOf: deps.sharesOf ?? (deps.engine as unknown as { sharesOf?: SharesOfPort }).sharesOf,
      chatId: ctx.chat.id,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  bot.command("shield", async (ctx) => {
    const text = await handleShield(ctx.match ?? "", {
      store: deps.store,
      engine: deps.engine,
      chatId: ctx.chat.id,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(handleHelp());
  });

  bot.command("stop", async (ctx) => {
    const text = await handleAlerts("off", {
      store: deps.store,
      engine: deps.engine,
      chatId: ctx.chat.id,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  return bot;
}

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
}

/**
 * Formats a plain-text Telegram alert message from an Alert object.
 */
export function formatTelegramAlert(alert: Alert): string {
  const icon = alert.severity === "critical" ? "🚨" : alert.severity === "warning" ? "⚠️" : "ℹ️";
  const lines = [
    `${icon} *Guardian Alert: ${alert.title}*`,
    "",
    alert.body,
    "",
    `_Evidence: ${alert.evidence.snapshotKind} snapshot (${new Date(alert.evidence.observedAt).toISOString()})_`,
  ];
  return lines.join("\n");
}

/**
 * Delivers pending alerts to linked Telegram chats.
 * Invariant: If delivery fails (e.g. Telegram down or network drop),
 * the error is reported via onWarn and health, but the alerts remain
 * stored in the snapshot store for the web feed and future delivery.
 */
export async function deliverPendingAlerts(
  sender: TelegramDeliverySender,
  alerts: readonly Alert[],
  store: SnapshotStore,
  now = Date.now(),
  onWarn = (_msg: string) => {},
): Promise<DeliverAlertsResult> {
  const result: DeliverAlertsResult = {
    attempted: 0,
    delivered: 0,
    failed: 0,
    suppressedByQuiet: 0,
    errors: [],
  };

  for (const alert of alerts) {
    const wallet = alert.walletAddress.toLowerCase();
    const linkSnap = store.latest<GuardianLinkData>("guardian-link", wallet, {
      maxAgeMs: 365 * 86_400_000,
      now,
    });

    if (!linkSnap?.data || !linkSnap.data.alertsEnabled) {
      continue; // Not linked or alerts disabled
    }

    const { chatId, quietHours } = linkSnap.data;

    // Check quiet hours
    if (isQuietHours(now, quietHours)) {
      result.suppressedByQuiet++;
      continue;
    }

    // If alert has a scheduled deliverAt from a previous quiet hours window,
    // only deliver once that window has passed
    if (alert.deliverAt && now < alert.deliverAt) {
      result.suppressedByQuiet++;
      continue;
    }

    result.attempted++;
    const message = formatTelegramAlert(alert);

    try {
      await sender.sendMessage(chatId, message, { parse_mode: "Markdown" });
      result.delivered++;
    } catch (err) {
      result.failed++;
      const errMsg = err instanceof Error ? err.message : String(err);
      result.errors.push(errMsg);
      onWarn(`Failed to deliver Telegram alert to chat ${chatId}: ${errMsg}`);
    }
  }

  return result;
}

/**
 * Verifies whether the Telegram bot is configured and reports to health.
 */
export function verifyTelegramConfig(
  env: Record<string, string | undefined> = process.env,
  health?: ModuleHealth,
  now = Date.now(),
): { ok: boolean; error?: string } {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || token.trim() === "") {
    const error = "Missing TELEGRAM_BOT_TOKEN environment variable";
    health?.report("guardian", {
      ok: false,
      error,
      now,
    });
    return { ok: false, error };
  }
  return { ok: true };
}
