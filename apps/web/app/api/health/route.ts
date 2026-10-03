import type { NextRequest } from "next/server";
import { getEngine, isFixtureMode } from "@/lib/server/engine";
import { json, rateLimited, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * Health (blueprint §14): Binance auth and the 40304 region detector, RPC height, the guard, the Ondo feed's age.
 * Returns 503 when Binance refuses our region or the key, so an uptime monitor pages ops. Reveals no secrets.
 */
export async function GET(req: NextRequest) {
  if (rateLimited(req, "health", 20)) return tooMany();
  const base = { service: "tally-web", time: new Date().toISOString(), fixtures: isFixtureMode() };
  try {
    const h = await (await getEngine()).health();
    const ok = h.binance === "ok" && h.rpcBlock !== null;
    if (h.binance === "region_block")
      console.error("ALERT region_block (40304) on /api/health: the server's region drifted");
    return json({ ok, ...base, ...h }, ok ? 200 : 503);
  } catch (e) {
    return json(
      { ok: false, ...base, error: e instanceof Error ? e.message : "engine failed to start" },
      503,
    );
  }
}
