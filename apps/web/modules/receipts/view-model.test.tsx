import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFixtureEngine } from "@tally/engine";
import { openStore, type OpenSnapshotStore } from "@tally/modkit";
import {
  HINT_KIND,
  HINT_TTL_MS,
  RECEIPTS_KIND,
  receiptHintKey,
  RECEIPT_MAX_AGE_MS,
  promoteReceipt,
  verifySignedCall,
  reconcile,
  type StoredReceipt,
  type StoredHint,
} from "@tally/mod-receipts";
import { recordedHint } from "../../../../packages/mod-receipts/src/fixtures/ingestion";
import { recordedReceipt } from "../../../../packages/mod-receipts/src/fixtures/recorded";
import { loadReceipt, loadReceipts } from "./view-model";
import { loadQuality } from "../quality/view-model";
vi.mock("../../components/module-boundary", () => ({ ModuleBoundary: () => null }));
import { ReceiptContent, ActivityContent } from "./plain";
import { QualityContent } from "../quality/plain";
vi.stubGlobal("React", React);
let store: OpenSnapshotStore;
beforeEach(() => {
  store = openStore(":memory:");
});
afterEach(() => store.close());
async function seed(name: "F11_NVDAB" | "F11_NVDAon" = "F11_NVDAB", trusted = false) {
  const engine = createFixtureEngine(),
    hint = recordedHint(name);
  const tx = (await engine.transactions.getTransaction(hint.txHash))!,
    mined = (await engine.transactions.getReceipt(hint.txHash))!;
  const tokens = await engine.ports.registry.tokensFor("NVDA");
  const data = promoteReceipt(
    hint,
    tx,
    mined,
    verifySignedCall(tx, hint, engine.trade.guard),
    tokens.find((t) => t.address.toLowerCase() === hint.quote!.stock.toLowerCase())!,
    1000,
  );
  if (trusted) {
    data.receipt = recordedReceipt(name);
    data.result = reconcile(data.receipt);
    data.baselineTrust = "recorded";
  }
  store.put({
    kind: RECEIPTS_KIND,
    key: hint.txHash,
    source: "recorded-chain",
    observedAt: 1000,
    data,
  });
  return data;
}
it("empty receipt, ActivityVM and QualityVM carry missing reasons and insufficient samples", async () => {
  const h = recordedHint(),
    options = { store, now: 1000, enabled: true };
  expect(await loadReceipt(h.txHash, options)).toMatchObject({
    state: "empty",
    reason: expect.any(String),
    ageMs: null,
  });
  expect(await loadReceipts(options)).toMatchObject({ state: "empty", pendingCount: 0 });
  const quality = await loadQuality(options);
  expect(quality).toMatchObject({ state: "empty", insufficient: true, report: { n: 0 } });
  expect(renderToStaticMarkup(<QualityContent vm={quality} />)).toContain(
    "Insufficient data: fewer than 5",
  );
});
it("pending-only and stale hints retain the hash, count pending and contribute no quality sample", async () => {
  const h = recordedHint();
  store.put({
    kind: HINT_KIND,
    key: receiptHintKey(h),
    observedAt: 1000,
    source: "untrusted-browser-hint",
    data: {
      hint: h,
      receivedAt: 1000,
      expiresAt: 1000 + HINT_TTL_MS,
      state: "pending",
      reason: "RPC unavailable",
    } satisfies StoredHint,
  });
  const options = { store, now: 1000 + RECEIPT_MAX_AGE_MS + 1, enabled: true };
  expect(await loadReceipt(h.txHash, options)).toMatchObject({
    state: "pending",
    status: "PENDING",
    txHash: h.txHash,
    stale: true,
  });
  const activity = await loadReceipts(options),
    quality = await loadQuality(options);
  expect(activity).toMatchObject({ pendingCount: 1, stale: true });
  expect(quality).toMatchObject({
    pendingCount: 1,
    unverifiedPendingCount: 1,
    stale: true,
    insufficient: true,
    report: { n: 0, fillRate: null },
  });
  expect(renderToStaticMarkup(<ActivityContent vm={activity} />)).toContain("1 pending");
});
it("F11 view models expose lossless ladder/evidence strings, source age and wallet-filtered activity", async () => {
  const data = await seed();
  const options = { store, now: 2000, enabled: true };
  const vm = await loadReceipt(data.hint.txHash, options);
  expect(vm).toMatchObject({
    state: "ready",
    status: "RECONCILED",
    ageMs: 1000,
    source: "recorded-chain",
    comparisonTrust: "client-hint",
  });
  expect(vm.ladder.map((s) => s.stage)).toEqual(["Quoted", "Simulated", "Received"]);
  expect(vm.ladder[1]).toMatchObject({ shares: null, reason: "Simulation not recorded" });
  expect(vm.ladder[2]!.shares).toBeTruthy();
  expect(vm.evidence.block).toBe("125272679");
  expect(vm.evidence.logIndices.length).toBeGreaterThan(0);
  expect(renderToStaticMarkup(<ReceiptContent vm={vm} />)).toContain("Signed minimum");
  expect((await loadReceipts({ ...options, wallet: data.transaction.sender })).items).toHaveLength(
    1,
  );
  expect(
    (await loadReceipts({ ...options, wallet: "0x1111111111111111111111111111111111111111" }))
      .items,
  ).toEqual([]);
  const quality = await loadQuality(options);
  expect(quality.report.vsQuote.n).toBe(0);
  expect(quality.report.unverifiedComparisonCount).toBe(1);
  expect(quality.report.byRouteLength[0]!.routeLength).toBeNull();
});
it("recorded F11 comparisons supply issuer and route rows; n=2 remains insufficient", async () => {
  await seed("F11_NVDAB", true);
  await seed("F11_NVDAon", true);
  const vm = await loadQuality({ store, now: 1000, enabled: true });
  expect(vm).toMatchObject({
    insufficient: true,
    report: { n: 2, vsQuote: { n: 2 }, vsSimulation: { n: 0 }, vsReference: { n: 0 } },
  });
  expect(vm.report.byIssuer).toHaveLength(2);
  expect(vm.report.byRouteLength.map((r) => r.routeLength)).toEqual([1, 2]);
  expect(renderToStaticMarkup(<QualityContent vm={vm} />)).toContain(
    "Insufficient data (n &lt; 5)",
  );
});
it("quote fallback differences have normal-fill copy, and resumed trades show verified output without inventing a quote", async () => {
  const data = await seed();
  const f6 = recordedReceipt("F6_NVDAB"),
    f6Engine = createFixtureEngine();
  const changed: StoredReceipt = {
    ...data,
    transaction: (await f6Engine.transactions.getTransaction(f6.txHash!))!,
    chainReceipt: (await f6Engine.transactions.getReceipt(f6.txHash!))!,
    receipt: f6,
    result: reconcile(f6),
    hint: { ...data.hint, txHash: f6.txHash!, intentId: f6.intent.id, user: f6.intent.user },
    verifiedFill: null,
  };
  store.put({
    kind: RECEIPTS_KIND,
    key: f6.txHash!,
    source: "recorded-chain",
    observedAt: 1001,
    data: changed,
  });
  expect((await loadReceipt(f6.txHash!, { store, now: 1001, enabled: true })).reason).toContain(
    "normal fill difference",
  );
  const engine = createFixtureEngine(),
    h = { ...data.hint, quote: null, isResumed: true };
  const tx = data.transaction,
    token = (await engine.ports.registry.tokensFor("NVDA")).find(
      (t) => t.address.toLowerCase() === data.receipt!.intent.asset.toLowerCase(),
    )!;
  const resumed = promoteReceipt(
    h,
    tx,
    data.chainReceipt,
    verifySignedCall(tx, h, engine.trade.guard),
    token,
    1002,
  );
  store.put({
    kind: RECEIPTS_KIND,
    key: h.txHash,
    source: "recorded-chain",
    observedAt: 1002,
    data: resumed,
  });
  const vm = await loadReceipt(h.txHash, { store, now: 1002, enabled: true });
  expect(vm.status).toBe("UNRECONCILED");
  expect(vm.ladder[0]!.shares).toBeNull();
  expect(vm.ladder[2]!.shares).toBeTruthy();
});
it("flag off does no store I/O and plain content renders nothing; store errors warn and expose a fixed reason", async () => {
  const read = vi.spyOn(store, "listLatest");
  const options = { store, enabled: false };
  const activity = await loadReceipts(options),
    quality = await loadQuality(options);
  expect(read).not.toHaveBeenCalled();
  expect(renderToStaticMarkup(<ActivityContent vm={activity} />)).toBe("");
  expect(renderToStaticMarkup(<QualityContent vm={quality} />)).toBe("");
  read.mockImplementation(() => {
    throw new Error("secret provider details");
  });
  const warn = vi.fn();
  expect(await loadQuality({ store, enabled: true, onWarn: warn })).toMatchObject({
    state: "error",
    error: "Snapshot store unavailable",
  });
  expect(warn.mock.calls.flat().join()).not.toContain("secret");
});

it("candidate hints keep transaction hashes, deduplicate pending counts and respect the wallet filter", async () => {
  const hint = recordedHint();
  const other = {
    ...hint,
    intentId: "synthetic-other",
    user: "0x1111111111111111111111111111111111111111" as const,
  };
  for (const candidate of [hint, other])
    store.put({
      kind: HINT_KIND,
      key: receiptHintKey(candidate),
      observedAt: 1000,
      source: "untrusted-browser-hint",
      data: {
        hint: candidate,
        receivedAt: 1000,
        expiresAt: 1000 + HINT_TTL_MS,
        state: candidate === hint ? "verified" : "pending",
        reason: "Synthetic pending candidate",
      } satisfies StoredHint,
    });
  const options = { store, now: 2000, enabled: true };
  expect(await loadReceipt(hint.txHash, options)).toMatchObject({
    txHash: hint.txHash,
    intentId: hint.intentId,
  });
  expect(await loadReceipts(options)).toMatchObject({
    pendingCount: 1,
    items: [{ txHash: hint.txHash }],
  });
  expect(await loadQuality(options)).toMatchObject({
    pendingCount: 1,
    unverifiedPendingCount: 1,
    report: { n: 0 },
  });
  expect((await loadReceipts({ ...options, wallet: hint.user })).items[0]?.intentId).toBe(
    hint.intentId,
  );
  await seed();
  expect(await loadQuality(options)).toMatchObject({ pendingCount: 0, unverifiedPendingCount: 0 });
  expect((await loadReceipts(options)).items).toHaveLength(1);
});
