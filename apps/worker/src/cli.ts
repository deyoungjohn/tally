import { createFixtureEngine, createLiveEngine } from "@tally/engine";
import { errorMessage, openStore } from "@tally/modkit";
import { runJobs, type WorkerJob } from "./runner";

async function main() {
  const name = process.argv[2];
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("Usage: pnpm worker <job>");
  const loaded = (await import(new URL(`./jobs/${name}.ts`, import.meta.url).href)) as {
    job?: WorkerJob;
  };
  const job = loaded.job;
  if (!job || job.name !== name || typeof job.run !== "function")
    throw new Error(`${name} must export job { name, intervalMs, run }`);
  const onWarn = (message: string) => console.warn(message);
  const engine =
    process.env.TALLY_FIXTURES === "1"
      ? createFixtureEngine({ onWarn })
      : createLiveEngine(process.env, onWarn);
  const store = openStore();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await runJobs(
      [job],
      { store, health: store.health, engine, onWarn, now: Date.now },
      controller.signal,
    );
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    store.close();
  }
}
main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
