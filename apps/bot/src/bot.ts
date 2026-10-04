import { Bot } from "grammy";
import type { Engine } from "@tally/engine";
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
      chatType: ctx.chat.type,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text);
  });

  bot.command("link", async (ctx) => {
    const text = await handleLink(ctx.match ?? "", {
      store: deps.store,
      engine: deps.engine,
      chatId: ctx.chat.id,
      chatType: ctx.chat.type,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text);
  });

  bot.command("alerts", async (ctx) => {
    const text = await handleAlerts(ctx.match ?? "", {
      store: deps.store,
      engine: deps.engine,
      chatId: ctx.chat.id,
      chatType: ctx.chat.type,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text);
  });

  bot.command("quiet", async (ctx) => {
    const text = await handleQuiet(ctx.match ?? "", {
      store: deps.store,
      engine: deps.engine,
      chatId: ctx.chat.id,
      chatType: ctx.chat.type,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text);
  });

  bot.command("quote", async (ctx) => {
    const text = await handleQuote(ctx.match ?? "", {
      store: deps.store,
      engine: deps.engine,
      chatId: ctx.chat.id,
      chatType: ctx.chat.type,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text);
  });

  bot.command("shares", async (ctx) => {
    const text = await handleShares(ctx.match ?? "", {
      store: deps.store,
      engine: deps.engine,
      sharesOf: deps.sharesOf ?? (deps.engine as unknown as { sharesOf?: SharesOfPort }).sharesOf,
      chatId: ctx.chat.id,
      chatType: ctx.chat.type,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text);
  });

  bot.command("shield", async (ctx) => {
    const text = await handleShield(ctx.match ?? "", {
      store: deps.store,
      engine: deps.engine,
      chatId: ctx.chat.id,
      chatType: ctx.chat.type,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text);
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(handleHelp());
  });

  bot.command("stop", async (ctx) => {
    const text = await handleAlerts("off", {
      store: deps.store,
      engine: deps.engine,
      chatId: ctx.chat.id,
      chatType: ctx.chat.type,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text);
  });

  return bot;
}

export {
  deliverPendingAlerts,
  formatTelegramAlert,
  type TelegramDeliverySender,
  type DeliverAlertsResult,
} from "@tally/mod-guardian";

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
