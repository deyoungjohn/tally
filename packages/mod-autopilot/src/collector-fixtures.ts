import { E18 } from "@tally/core";
import type { SnapshotStore } from "@tally/modkit";
import { vi } from "vitest";
import type { WorkerContext } from "../../../apps/worker/src/runner";
import {
  CONSTRUCTED_NOW as now,
  CONSTRUCTED_WALLET as wallet,
  CONSTRUCTED_TOKEN as token,
} from "./fixtures";

export const registryRow = {
  binanceChainId: "56",
  tokenContractAddress: token,
  underlyingTicker: "NFLX",
  platformId: "ondo",
  tokenSymbol: "NFLXon",
  decimals: "18",
  referencePrice: "100",
  tokenToShareRatio: "10",
};
export function seedRegistry(store: SnapshotStore) {
  store.put({
    kind: "registry",
    key: "bsc",
    data: [registryRow],
    source: "constructed",
    observedAt: now,
  });
}
export function collectorContext(store: SnapshotStore): WorkerContext {
  const capabilities = {
    sharesOf: vi.fn(async () => ({
      address: wallet,
      asOf: new Date(now).toISOString(),
      tickers: ["NFLX"],
      rows: [
        {
          address: token,
          ticker: "NFLX",
          symbol: "NFLXon",
          issuer: "ondo",
          decimals: 18,
          balance: 10n * E18,
          shares: 100n * E18,
          multiplier: 10n * E18,
          source: "api",
          degraded: false,
          reason: null,
        },
      ],
      groups: [],
      failed: [],
      warnings: [],
    })),
    facts: vi.fn(async () => [{ address: token, integrity: { grade: "D" } }]),
    pauseState: vi.fn(async () => ({ paused: false, reason: null, observedAt: now })),
  };
  // Deliberately partial read-only engine; every other capability is a trap.
  const engine = new Proxy(capabilities, {
    get(target, name) {
      if (name in target) return target[name as keyof typeof target];
      throw new Error("Autopilot must not access execution or other engine capabilities");
    },
  }) as unknown as WorkerContext["engine"];
  return {
    store,
    health: { report: () => {}, get: () => null, all: () => [] },
    engine,
    now: () => now,
    onWarn: vi.fn(),
  };
}
