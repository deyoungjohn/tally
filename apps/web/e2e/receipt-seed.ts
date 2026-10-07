/**
 * Seeds an isolated TALLY_DATA_DIR for the receipt and quality page e2e (run through tsx, never in production):
 *  - the recorded F11 bStock buy as a chain-verified receipt with a recorded comparison;
 *  - the recorded F11 Ondo buy as a chain-verified receipt whose quote came from the browser, observed long ago (stale);
 *  - a pending attempt known only from a browser hint (no chain evidence).
 */
import { createFixtureEngine } from "@tally/engine";
import { openStore } from "@tally/modkit";
import {
  HINT_KIND,
  HINT_TTL_MS,
  RECEIPTS_KIND,
  RECEIPT_MAX_AGE_MS,
  promoteReceipt,
  receiptHintKey,
  reconcile,
  verifySignedCall,
  type StoredHint,
} from "@tally/mod-receipts";
import { recordedHint } from "../../../packages/mod-receipts/src/fixtures/ingestion";
import { recordedReceipt } from "../../../packages/mod-receipts/src/fixtures/recorded";

export const PENDING_HASH = `0x${"9e".repeat(32)}`;

async function main() {
  if (!process.env.TALLY_DATA_DIR) throw new Error("receipt-seed needs an isolated TALLY_DATA_DIR");
  const engine = createFixtureEngine();
  const store = openStore();
  const now = Date.now();
  try {
    for (const [name, recorded, observedAt] of [
      ["F11_NVDAB", true, now],
      ["F11_NVDAon", false, now - 2 * RECEIPT_MAX_AGE_MS],
    ] as const) {
      const hint = recordedHint(name);
      const tx = (await engine.transactions.getTransaction(hint.txHash))!;
      const mined = (await engine.transactions.getReceipt(hint.txHash))!;
      const token = (await engine.ports.registry.tokensFor("NVDA")).find(
        (t) => t.address.toLowerCase() === hint.quote!.stock.toLowerCase(),
      )!;
      const data = promoteReceipt(
        hint,
        tx,
        mined,
        verifySignedCall(tx, hint, engine.trade.guard),
        token,
        observedAt,
      );
      if (recorded) {
        data.receipt = recordedReceipt(name);
        data.result = reconcile(data.receipt);
        data.baselineTrust = "recorded";
      }
      store.put({
        kind: RECEIPTS_KIND,
        key: hint.txHash,
        source: "recorded-chain",
        observedAt,
        data,
      });
    }
    const pending = { ...recordedHint("F11_NVDAB"), txHash: PENDING_HASH as `0x${string}` };
    store.put({
      kind: HINT_KIND,
      key: receiptHintKey(pending),
      observedAt: now,
      source: "untrusted-browser-hint",
      data: {
        hint: pending,
        receivedAt: now,
        expiresAt: now + HINT_TTL_MS,
        state: "pending",
        reason: "Awaiting a mined receipt; transaction hash retained",
      } satisfies StoredHint,
    });
    for (const module of ["receipts", "quality", "statement"] as const)
      store.health.report(module, { ok: true, now, intervalMs: 15_000 });
  } finally {
    store.close();
  }
}
main().catch((e) => {
  console.error("receipt seed failed", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
