/**
 * Marks the named modules as having updated successfully, in an isolated TALLY_DATA_DIR (run through tsx, never in
 * production). Screens whose data is private or loaded in the browser need only the module to count as running.
 */
import { openStore } from "@tally/modkit";

async function main() {
  if (!process.env.TALLY_DATA_DIR) throw new Error("health-seed needs an isolated TALLY_DATA_DIR");
  const store = openStore();
  const now = Date.now();
  try {
    for (const module of process.argv.slice(2))
      store.health.report(module as never, { ok: true, now, intervalMs: 300_000 });
  } finally {
    store.close();
  }
}
main().catch((e) => {
  console.error("health seed failed", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
