import { runGuardianEvaluation, type TelegramDeliverySender } from "@tally/mod-guardian";
import type { WorkerJob } from "../runner";

/**
 * Worker job for WO-06 Guardian alerts:
 * Evaluates holdings of subscribed users once per minute from snapshots.
 * Writes generated alerts to the SnapshotStore under kind "alerts" (wallet-keyed),
 * ensuring prune protection and strict per-wallet isolation.
 * Dispatches pending alerts to linked Telegram chats using unified deliverPendingAlerts.
 */
export const job: WorkerJob = {
  name: "guardian",
  intervalMs: 60_000, // 1 minute
  async run(ctx) {
    // 1. Feature flag gate
    if (process.env.FEATURE_GUARDIAN !== "1") {
      return;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const sender: TelegramDeliverySender | undefined = token
      ? {
          async sendMessage(chatId, text) {
            const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: chatId, text }),
            });
            if (!res.ok) {
              throw new Error(`Telegram API responded with ${res.status}: ${await res.text()}`);
            }
          },
        }
      : undefined;

    await runGuardianEvaluation({
      store: ctx.store,
      health: ctx.health,
      now: ctx.now,
      onWarn: ctx.onWarn,
      sender,
      testWallet: process.env.TALLY_TEST_WALLET,
      isProduction: process.env.NODE_ENV === "production",
    });
  },
};
