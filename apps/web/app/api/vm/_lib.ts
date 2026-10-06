import type { NextRequest } from "next/server";
import type { ModuleName } from "@tally/config";
import { moduleHealthState, openStore, type OpenSnapshotStore } from "@tally/modkit";
import { moduleFlags } from "@/lib/flags";
import { fail, json, rateLimited, tooMany } from "@/lib/server/http";

/** What every `/api/vm/*` route answers: the module's own view model plus how fresh the module is. */
export interface VmEnvelope<T> {
  module: ModuleName;
  /** The module has never had a successful update, or its last run failed or is overdue. */
  degraded: boolean;
  stale: boolean;
  ageMs: number | null;
  reason: string | null;
  /** True when the server runs on recorded fixtures: the screen labels the data as such, never as live. */
  fixtures: boolean;
  /** Null when the module has never succeeded: nothing is claimed. */
  vm: T | null;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Shared shell of the public-data view-model routes (portfolio, statement, activity: all public chain data, so the wallet
 * comes from the query). Off (404) when the module's flag is off; rate-limited; the store is opened per request and closed.
 * Never used for private data (Guardian): that must not take an address from the request.
 */
export async function vmRoute<T>(
  req: NextRequest,
  module: ModuleName,
  load: (ctx: { store: OpenSnapshotStore; wallet: string }) => Promise<T>,
) {
  if (!moduleFlags()[module]) return new Response(null, { status: 404 });
  if (rateLimited(req, `vm-${module}`, 60)) return tooMany();
  const wallet = req.nextUrl.searchParams.get("address") ?? "";
  if (!ADDRESS.test(wallet)) return fail(400, "invalid_request", "A wallet address is required.");
  let store: OpenSnapshotStore | undefined;
  try {
    store = openStore();
    const row = store.health.get(module);
    const state = moduleHealthState(row);
    const envelope = (vm: T | null): VmEnvelope<T> => ({
      module,
      degraded: state.degraded,
      stale: state.stale,
      ageMs: state.ageMs,
      reason: state.reason,
      fixtures: process.env.TALLY_FIXTURES === "1",
      vm,
    });
    // Like <ModuleBoundary>: a module that has never updated successfully shows its degraded card, with no data.
    if (row?.lastOkAt === undefined) return json(envelope(null));
    return json(envelope(await load({ store, wallet })));
  } catch {
    console.warn(`${module} view model unavailable; showing its degraded state`);
    return json({
      module,
      degraded: true,
      stale: false,
      ageMs: null,
      reason: "Temporarily unavailable",
      fixtures: process.env.TALLY_FIXTURES === "1",
      vm: null,
    } satisfies VmEnvelope<T>);
  } finally {
    store?.close();
  }
}
