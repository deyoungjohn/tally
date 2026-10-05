import { runGuardianEvaluation } from "@tally/mod-guardian";
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

    await runGuardianEvaluation({
      store: ctx.store,
      health: ctx.health,
      now: ctx.now,
      onWarn: ctx.onWarn,
      telegramToken: process.env.TELEGRAM_BOT_TOKEN,
      testWallet: process.env.TALLY_TEST_WALLET,
      isProduction: process.env.NODE_ENV === "production",
    });
  },
};
