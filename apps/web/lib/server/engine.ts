import { existsSync } from "node:fs";
import path from "node:path";
import type { Engine } from "@tally/engine";

/** The repo root holds `data/` (Ondo baseline seed) and the recorded fixtures. A bundled server cannot find it from its own file. */
function findRepoRoot(from: string): string | undefined {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "data", "ondo-multiplier-baseline.json"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

const g = globalThis as { __tallyEngine?: Promise<Engine> };

function warn(m: string) {
  console.warn(`[engine] ${m}`);
}

/**
 * One engine per server process. `TALLY_FIXTURES=1` runs offline from recorded fixtures (tests, local dev);
 * otherwise it is the live engine and needs the Binance key (Seoul EC2 only: the API refuses US callers).
 * Imported lazily so TALLY_REPO_ROOT is set before the engine modules read it.
 */
export function getEngine(): Promise<Engine> {
  g.__tallyEngine ??= (async () => {
    process.env.TALLY_REPO_ROOT ??= findRepoRoot(process.cwd());
    const { createFixtureEngine, createLiveEngine } = await import("@tally/engine");
    return process.env.TALLY_FIXTURES === "1"
      ? createFixtureEngine({ onWarn: warn })
      : createLiveEngine(process.env, warn);
  })();
  // A failed construction (e.g. a missing key) must not be cached forever.
  g.__tallyEngine.catch(() => {
    g.__tallyEngine = undefined;
  });
  return g.__tallyEngine;
}

export const isFixtureMode = () => process.env.TALLY_FIXTURES === "1";
