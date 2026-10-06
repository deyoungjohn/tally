import type { NextRequest } from "next/server";
import { formatUnits } from "@tally/core";
import { RECEIPTS_KIND, RECEIPT_MAX_AGE_MS, type StoredReceipt } from "@tally/mod-receipts";
import { openStore } from "@tally/modkit";
import { getEngine } from "../../../lib/server/engine";
import { fail, json, rateLimited, tooMany } from "../../../lib/server/http";
import { createReceiptPost } from "../../../modules/receipts/ingestion";
let store: ReturnType<typeof openStore> | undefined;
const getStore = () => (store ??= openStore());
export const POST = createReceiptPost({
  trustedOrigin: process.env.TALLY_APP_ORIGIN,
  enabled: () => process.env.FEATURE_RECEIPTS === "1",
  engine: getEngine,
  store: getStore,
  now: Date.now,
  onWarn: (m) => console.warn(m),
});

export const dynamic = "force-dynamic";

/**
 * The chain-verified outcome of one sale, for the sell sheet. Only what the worker has reconciled from the chain is returned:
 * until then the answer is "pending" and carries no amounts. Off (404) when receipts are off. Never returns logs, senders or
 * provider details.
 */
export async function GET(req: NextRequest) {
  if (process.env.FEATURE_RECEIPTS !== "1") return new Response(null, { status: 404 });
  if (rateLimited(req, "receipt-read", 120)) return tooMany();
  const hash = req.nextUrl.searchParams.get("hash") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return fail(400, "invalid_request", "Invalid hash.");
  try {
    const snap = getStore().latest<StoredReceipt>(RECEIPTS_KIND, hash.toLowerCase(), {
      maxAgeMs: RECEIPT_MAX_AGE_MS,
      now: Date.now(),
    });
    const d = snap?.data;
    const status = d?.result?.status ?? (d?.chainReceipt?.status === "reverted" ? "FAILED" : null);
    if (!d || !status || status === "PENDING") return json({ state: "pending", hash });
    if (status === "FAILED") return json({ state: "failed", hash });
    if (d.kind === "sell" && d.result?.tokensReceived != null && d.result.tokensSpent != null)
      return json({
        state: "reconciled",
        hash,
        usdtReceived: formatUnits(d.result.tokensReceived, 18),
        usdtReceivedRaw: d.result.tokensReceived.toString(),
        tokensSpent: formatUnits(d.result.tokensSpent, 18),
        diffVsQuoteBps: d.result.diffVsQuoteBps ?? null,
      });
    return json({ state: "unreconciled", hash });
  } catch {
    return json({ state: "pending", hash });
  }
}
