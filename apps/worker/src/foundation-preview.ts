import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage, openStore } from "@tally/modkit";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDir = mkdtempSync(join(tmpdir(), "tally-foundation-preview-"));
const env = {
  ...process.env,
  TALLY_DATA_DIR: dataDir,
  TALLY_FIXTURES: "1",
  TALLY_ALLOW_MISSING_GEO: "1",
  TALLY_DEV_PREVIEWS: "1",
  FEATURE_FLOW: "1",
  FEATURE_STATEMENT: "1",
  FEATURE_GUARDIAN: "1",
  FEATURE_AUTOPILOT: "1",
  FEATURE_QUALITY: "0",
  FEATURE_REWARDS: "1",
  PORT: "3101",
  HOSTNAME: "127.0.0.1",
};
const children: ChildProcess[] = [];
let stopped = false;
function stop() {
  if (stopped) return;
  stopped = true;
  for (const child of children)
    if (child.pid && child.exitCode === null) process.kill(-child.pid, "SIGINT");
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

async function main() {
  // Exercises the exact work-order CLI, in its own process, against a shared SQLite file.
  const worker = spawn("pnpm", ["--silent", "worker", "collect-registry"], {
    cwd: root,
    env,
    detached: true,
    stdio: "inherit",
  });
  children.push(worker);
  const workerExit = new Promise<void>((resolve) => worker.once("exit", () => resolve()));
  const store = openStore(join(dataDir, "tally.db"));
  try {
    let ready = false;
    for (let attempt = 0; attempt < 600 && !stopped; attempt++) {
      if (
        store.health.get("collect-registry")?.ok &&
        store.latest("registry", "bsc", { maxAgeMs: 60_000 })
      ) {
        ready = true;
        break;
      }
      if (worker.exitCode !== null)
        throw new Error("Fixture registry worker exited before writing a snapshot");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error("Fixture registry worker did not write a snapshot");
    const lastOkAt = Date.now() - 240_000;
    store.health.report("flow", { ok: true, now: Date.now(), intervalMs: 15_000 });
    store.health.report("guardian", { ok: true, now: lastOkAt, intervalMs: 60_000 });
    store.health.report("guardian", {
      ok: false,
      error: "Fixture primary source unavailable",
      intervalMs: 60_000,
    });
    store.health.report("autopilot", { ok: true, now: lastOkAt, intervalMs: 60_000 });
    store.health.report("statement", { ok: true, now: lastOkAt, intervalMs: 300_000 });
    store.health.report("rewards", {
      ok: false,
      error: "First fixture run failed",
      intervalMs: 60_000,
    });
    const web = spawn(process.execPath, ["apps/web/.next/standalone/apps/web/server.js"], {
      cwd: root,
      env,
      detached: true,
      stdio: "inherit",
    });
    children.push(web);
    await new Promise<void>((resolve, reject) => {
      web.once("error", reject);
      web.once("exit", (code) =>
        stopped || code === 0
          ? resolve()
          : reject(new Error(`Foundation web server exited with code ${code}`)),
      );
    });
  } finally {
    stop();
    await workerExit;
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}
main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
