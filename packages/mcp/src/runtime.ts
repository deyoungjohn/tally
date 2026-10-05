import { createFixtureEngine, createLiveEngine, FIXTURE_NOW, type Engine } from "@tally/engine";
import { SHAREGUARD_DEPLOYED } from "@tally/config";
import { safeText } from "./output";

/** Exclude the feed signer before accessing values, including getters. MCP never reads this secret. */
export function unsignedEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const safe: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    if (key !== "FEED_SIGNER_PK") safe[key] = env[key];
  }
  return safe;
}

export interface Runtime {
  engine: Engine;
  fixtures: boolean;
  now: () => number;
  onWarn: (message: string) => void;
}

export function createRuntime(
  env: Record<string, string | undefined> = process.env,
  onWarn: (message: string) => void = (message) =>
    process.stderr.write(`tally: ${safeText(message)}\n`),
): Runtime {
  const safe = unsignedEnv(env);
  if (
    safe.SHAREGUARD_ADDRESS &&
    safe.SHAREGUARD_ADDRESS.toLowerCase() !== SHAREGUARD_DEPLOYED.toLowerCase()
  ) {
    throw new Error("MCP requires the deployed ShareGuard address.");
  }
  const fixtures = safe.TALLY_FIXTURES === "1";
  return {
    engine: fixtures ? createFixtureEngine({ onWarn }) : createLiveEngine(safe, onWarn),
    fixtures,
    now: fixtures ? () => FIXTURE_NOW : Date.now,
    onWarn,
  };
}
