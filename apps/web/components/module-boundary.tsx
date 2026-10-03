import "server-only";
import type { ReactNode } from "react";
import type { ModuleName } from "@tally/config";
import {
  moduleHealthState,
  openStore,
  type HealthRow,
  type ModuleHealthState,
  type OpenSnapshotStore,
} from "@tally/modkit";
import { moduleFlags } from "@/lib/flags";
import { DegradedCard, ModuleBoundaryClient } from "./module-boundary-client";

let store: OpenSnapshotStore | undefined;
export function readModuleHealth(): HealthRow[] {
  return (store ??= openStore()).health.all();
}

/** Use load for server work: React client boundaries cannot catch errors evaluating an RSC child. */
export async function ModuleBoundary({
  module,
  children,
  load,
  fallback,
}: {
  module: ModuleName;
  children?: ReactNode;
  load?: (state: ModuleHealthState) => ReactNode | Promise<ReactNode>;
  fallback?: ReactNode;
}) {
  if (!moduleFlags()[module]) return null;
  let health: HealthRow | undefined;
  try {
    health = readModuleHealth().find((r) => r.module === module);
    const state = moduleHealthState(health ?? null);
    if (health?.lastOkAt === undefined)
      return fallback ?? <DegradedCard module={module} lastOkAt={health?.lastOkAt} />;
    const content = load ? await load(state) : children;
    return (
      <ModuleBoundaryClient
        module={module}
        lastOkAt={health?.lastOkAt}
        health={state}
        fallback={fallback}
      >
        {content}
      </ModuleBoundaryClient>
    );
  } catch {
    console.warn(`${module} server loading failed; showing its degraded card`);
    return fallback ?? <DegradedCard module={module} lastOkAt={health?.lastOkAt} />;
  }
}
