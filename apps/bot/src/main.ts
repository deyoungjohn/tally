import { createFixtureEngine, createLiveEngine } from "@tally/engine";
import { openStore, type ModuleHealth } from "@tally/modkit";
import { createBot, verifyTelegramConfig } from "./bot";

export async function main(): Promise<void> {
  // Gate execution on FEATURE_GUARDIAN=1 (Finding 2)
  if (process.env.FEATURE_GUARDIAN !== "1") {
    console.log("FEATURE_GUARDIAN is not set to '1'. Exiting Guardian bot.");
    process.exit(0);
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const store = openStore();

  const health: ModuleHealth = {
    get: () => ({ module: "guardian", ok: true, lastRunAt: Date.now() }),
    all: () => [],
    report: (module, res) => {
      store.put({
        kind: "health",
        key: module,
        data: res,
        source: "bot",
        observedAt: Date.now(),
      });
    },
  };

  const config = verifyTelegramConfig(process.env, health);
  if (!config.ok || !token) {
    console.error(
      `Telegram bot startup failed: ${config.error ?? "Missing TELEGRAM_BOT_TOKEN environment variable"}`,
    );
    process.exit(1);
  }

  const engine =
    process.env.TALLY_FIXTURES === "1"
      ? createFixtureEngine()
      : createLiveEngine(process.env, (msg) => console.warn(`[guardian-engine] ${msg}`));

  const bot = createBot(token, {
    store,
    engine,
    health,
    onWarn: (msg) => console.warn(`[guardian-bot] ${msg}`),
  });

  const stop = async () => {
    console.log("Received shutdown signal. Stopping Guardian bot...");
    await bot.stop();
    process.exit(0);
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  console.log("Starting Tally Guardian Telegram bot (long polling)...");
  await bot.start();
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  main().catch((err) => {
    console.error(`Fatal bot error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
