/** Offline preview only: records actual F11 transaction evidence and original recorded quotes. */
import { createFixtureEngine } from "@tally/engine";
import { openStore } from "@tally/modkit";
import { promoteReceipt, verifySignedCall, reconcile, RECEIPTS_KIND } from "@tally/mod-receipts";
import { recordedHint } from "../../../../../packages/mod-receipts/src/fixtures/ingestion";
import { recordedReceipt } from "../../../../../packages/mod-receipts/src/fixtures/recorded";
async function seed() {
  if (process.env.TALLY_RECEIPT_PREVIEW !== "1" || !process.env.TALLY_DATA_DIR)
    throw new Error("Preview needs an explicit isolated TALLY_DATA_DIR");
  const engine = createFixtureEngine(),
    store = openStore();
  const now = Date.now();
  try {
    for (const name of ["F11_NVDAB", "F11_NVDAon"] as const) {
      const hint = recordedHint(name),
        tx = (await engine.transactions.getTransaction(hint.txHash))!,
        mined = (await engine.transactions.getReceipt(hint.txHash))!;
      const token = (await engine.ports.registry.tokensFor("NVDA")).find(
        (t) => t.address.toLowerCase() === hint.quote!.stock.toLowerCase(),
      )!;
      const data = promoteReceipt(
        hint,
        tx,
        mined,
        verifySignedCall(tx, hint, engine.trade.guard),
        token,
        now,
      );
      data.receipt = recordedReceipt(name);
      data.result = reconcile(data.receipt);
      data.baselineTrust = "recorded";
      store.put({
        kind: RECEIPTS_KIND,
        key: hint.txHash,
        source: "recorded-chain",
        observedAt: now,
        data,
      });
    }
    for (const module of ["receipts", "quality"] as const)
      store.health.report(module, { ok: true, now, intervalMs: 15_000 });
  } finally {
    store.close();
  }
}
seed().catch(() => {
  console.error("Offline receipt preview seeding failed; details withheld");
  process.exitCode = 1;
});
