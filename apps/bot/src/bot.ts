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
  redactSecrets,
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

  // Re-review 2 Finding 5: Log redacted error and continue so errors do not crash long polling
  bot.catch((err) => {
    const rawMsg = err.error instanceof Error ? err.error.message : String(err.error);
    deps.onWarn?.(`Telegram bot handler error: ${redactSecrets(rawMsg)}`);
  });

  bot.command("start", async (ctx) => {
    const text = await handleStart(ctx.match ?? "", {
      store: deps.store,
      engine: deps.engine,
      chatId: ctx.chat.id,
      chatType: ctx.chat.type,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text, { parse_mode: "HTML" });
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
    await ctx.reply(text, { parse_mode: "HTML" });
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
    await ctx.reply(text, { parse_mode: "HTML" });
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
    await ctx.reply(text, { parse_mode: "HTML" });
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
    await ctx.reply(text, { parse_mode: "HTML" });
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
    await ctx.reply(text, { parse_mode: "HTML" });
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
    await ctx.reply(text, { parse_mode: "HTML" });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(handleHelp(), { parse_mode: "HTML" });
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
    await ctx.reply(text, { parse_mode: "HTML" });
  });

  bot.command("unlink", async (ctx) => {
    const { handleUnlink } = await import("./commands");
    const text = await handleUnlink({
      store: deps.store,
      engine: deps.engine,
      chatId: ctx.chat.id,
      chatType: ctx.chat.type,
      now,
      onWarn: deps.onWarn,
    });
    await ctx.reply(text, { parse_mode: "HTML" });
  });

  bot.api
    .setMyCommands([
      { command: "start", description: "Start the bot" },
      { command: "link", description: "Link your Telegram to your Tally wallet" },
      { command: "unlink", description: "Unlink your Tally wallet and stop alerts" },
      { command: "alerts", description: "Turn Guardian alert notifications on or off" },
      { command: "quiet", description: "Set quiet hours in UTC or turn off" },
      { command: "quote", description: "Compare issuers in shares" },
      { command: "shares", description: "Portfolio holdings in shares across issuers" },
      { command: "shield", description: "Flagged tokens, traps and integrity grades" },
      { command: "help", description: "Show this help message" },
    ])
    .catch((err) => {
      deps.onWarn?.(`Failed to set Telegram commands: ${redactSecrets(String(err))}`);
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
