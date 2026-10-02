import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** M0 stub. M1 adds Binance auth, the 40304 detector, RPC height and feed freshness (blueprint §14). */
export function GET() {
  return NextResponse.json({ ok: true, service: "tally-web", time: new Date().toISOString() });
}
