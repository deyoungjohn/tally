import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFixtureEngine, type Engine } from "@tally/engine";
import { openStore, type OpenSnapshotStore } from "@tally/modkit";
import {
  HINT_KIND,
  HINT_TTL_MS,
  RECEIPTS_KIND,
  receiptHintKey,
  type StoredHint,
  type StoredReceipt,
} from "@tally/mod-receipts";
import { recordedHint } from "../../../../../packages/mod-receipts/src/fixtures/ingestion";
import edges from "../../../../../packages/mod-receipts/src/fixtures/ingestion-edges.synthetic.json";
import { createReceiptPost } from "../../../modules/receipts/ingestion";
import { job } from "../../../../worker/src/jobs/receipts";
import { loadReceipt, loadReceipts } from "../../../modules/receipts/view-model";
import { loadQuality } from "../../../modules/quality/view-model";
let store: OpenSnapshotStore;
let engine: Engine;
const hint = recordedHint();
const warn = vi.fn();
function post(options: Partial<Parameters<typeof createReceiptPost>[0]> = {}) {
  return createReceiptPost({
    enabled: () => true,
    store: () => store,
    engine: async () => engine,
    now: () => 1000,
    onWarn: warn,
    ...options,
  });
}
function request(value: unknown = hint, headers: HeadersInit = {}) {
  return new Request("https://tally.test/api/receipts", {
    method: "POST",
    headers: { origin: "https://tally.test", "content-type": "application/json", ...headers },
    body: JSON.stringify(value),
  });
}
function run(now = 1000) {
  return job.run({ store, engine, health: store.health, onWarn: warn, now: () => now });
}
beforeEach(() => {
  store = openStore(":memory:");
  engine = createFixtureEngine();
  vi.stubEnv("FEATURE_RECEIPTS", "1");
  vi.stubEnv("FEATURE_QUALITY", "1");
  warn.mockClear();
});
afterEach(() => {
  store.close();
  vi.unstubAllEnvs();
});
it("flag off returns 404 before constructing the engine or opening storage", async () => {
  const open = vi.fn(),
    read = vi.fn();
  expect((await post({ enabled: () => false, store: open, engine: read })(request())).status).toBe(
    404,
  );
  expect(open).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});
it("rejects non-POST, cross-origin, wrong content type, malformed JSON, and untrusted realized fields", async () => {
  const send = post();
  expect((await send(new Request("https://tally.test/api/receipts"))).status).toBe(405);
  expect((await send(request(hint, { origin: "https://evil.test" }))).status).toBe(403);
  expect((await send(request(hint, { "content-type": "text/plain" }))).status).toBe(415);
  expect((await send(request({ ...hint, realized: { tokensOut: "99999" } }))).status).toBe(400);
  expect(
    (
      await send(
        new Request("https://tally.test/api/receipts", {
          method: "POST",
          headers: { origin: "https://tally.test", "content-type": "application/json" },
          body: "{",
        }),
      )
    ).status,
  ).toBe(400);
  expect(store.listLatest(HINT_KIND, { maxAgeMs: 0 })).toEqual([]);
});
it("caps actual streamed body bytes, including absent or lying Content-Length", async () => {
  const send = post();
  for (const length of [undefined, "1", "20000"]) {
    const headers = {
      origin: "https://tally.test",
      "content-type": "application/json",
      ...(length ? { "content-length": length } : {}),
    };
    const oversized = new Request("https://tally.test/api/receipts", {
      method: "POST",
      headers,
      body: "x".repeat(16 * 1024 + 1),
    });
    expect((await send(oversized)).status).toBe(413);
  }
});
it("F11 hint is idempotent, then worker promotes full chain evidence with no original simulation", async () => {
  const send = post();
  expect((await send(request())).status).toBe(202);
  expect((await send(request())).status).toBe(200);
  expect(store.history(HINT_KIND, receiptHintKey(hint), 0)).toHaveLength(1);
  expect(store.latest(RECEIPTS_KIND, hint.txHash, { maxAgeMs: 0 })).toBeNull();
  await run();
  const actual = store.latest<StoredReceipt>(RECEIPTS_KIND, hint.txHash, { maxAgeMs: 0 })!.data;
  expect(actual.result?.status).toBe("RECONCILED");
  expect(actual.receipt?.simulation).toBeNull();
  expect(actual.receipt?.realized?.logs).toEqual(
    (await engine.transactions.getReceipt(hint.txHash))!.logs,
  );
  expect(actual.receipt?.intent.minShares.toString()).toBe(hint.quote!.minShares);
  expect(actual.baselineTrust).toBe("client-hint");
  expect((await send(request())).status).toBe(200);
  expect((await send(request({ ...hint, intentId: "other" }))).status).toBe(409);
});
it("RPC down leaves a hash-bearing pending hint, quality excludes and counts it, and later recovery promotes it", async () => {
  const real = engine;
  engine = {
    ...engine,
    transactions: {
      getTransaction: async () => {
        throw new Error("provider URL with key must never escape");
      },
      getReceipt: async () => null,
    },
  };
  expect((await post()(request())).status).toBe(202);
  await expect(run()).rejects.toThrow("pending hashes retained");
  const vm = await loadReceipt(hint.txHash, { store, now: 1000 });
  expect(vm).toMatchObject({ state: "pending", status: "PENDING", txHash: hint.txHash });
  expect(await loadQuality({ store, now: 1000 })).toMatchObject({
    pendingCount: 1,
    report: { n: 0, completedCount: 0 },
    insufficient: true,
  });
  expect(warn.mock.calls.flat().join()).not.toMatch(/URL|key must/);
  engine = real;
  await run(2000);
  expect((await loadReceipt(hint.txHash, { store, now: 2000 })).status).toBe("RECONCILED");
});
it("known pending transaction is protected evidence and survives hint expiry", async () => {
  const real = engine.transactions;
  engine = {
    ...engine,
    transactions: {
      getTransaction: async (hash) => ({
        ...(await real.getTransaction(hash))!,
        blockNumber: null,
      }),
      getReceipt: async () => null,
    },
  };
  await post()(request());
  await run();
  expect(
    store.latest<StoredReceipt>(RECEIPTS_KIND, hint.txHash, { maxAgeMs: 0 })!.data.result?.status,
  ).toBe("PENDING");
  await run(1000 + HINT_TTL_MS + 1);
  expect(store.latest(HINT_KIND, receiptHintKey(hint), { maxAgeMs: 0 })).toBeNull();
  expect((await loadReceipt(hint.txHash, { store, now: 1000 + HINT_TTL_MS + 1 })).status).toBe(
    "PENDING",
  );
});
it("an expired unknown hint is cleaned up, never promoted and disappears from activity", async () => {
  await post()(request({ ...hint, txHash: edges.missingHash }));
  await run(1000 + HINT_TTL_MS + 1);
  expect(store.listLatest(HINT_KIND, { maxAgeMs: 0 })).toEqual([]);
  expect(store.listLatest(RECEIPTS_KIND, { maxAgeMs: 0 })).toEqual([]);
  expect((await loadReceipts({ store, now: 1000 + HINT_TTL_MS + 1 })).state).toBe("empty");
});
it("rejects another destination, wrong sender and mismatched signed floor before storing a hint", async () => {
  const original = engine.transactions;
  for (const field of [{ destination: edges.wrongDestination }, { sender: edges.wrongSender }]) {
    engine = {
      ...engine,
      transactions: {
        ...original,
        getTransaction: async (hash) =>
          ({ ...(await original.getTransaction(hash))!, ...field }) as Awaited<
            ReturnType<typeof original.getTransaction>
          >,
      },
    };
    expect((await post()(request())).status).toBe(422);
  }
  engine = { ...engine, transactions: original };
  expect(
    (await post()(request({ ...hint, quote: { ...hint.quote, minShares: "1" } }))).status,
  ).toBe(422);
  expect(store.listLatest(HINT_KIND, { maxAgeMs: 0 })).toEqual([]);
});
it("worker rejects a previously unknown transaction when it resolves to a foreign destination", async () => {
  const original = engine.transactions;
  engine = { ...engine, transactions: { ...original, getTransaction: async () => null } };
  await post()(request());
  engine = {
    ...engine,
    trade: { ...engine.trade, guard: edges.wrongDestination as `0x${string}` },
    transactions: {
      ...original,
      getTransaction: async (hash) => ({
        ...(await original.getTransaction(hash))!,
        destination: edges.wrongDestination as `0x${string}`,
      }),
    },
  };
  await run();
  expect(
    store.latest<StoredHint>(HINT_KIND, receiptHintKey(hint), { maxAgeMs: 0 })!.data.state,
  ).toBe("rejected");
  expect(store.listLatest(RECEIPTS_KIND, { maxAgeMs: 0 })).toEqual([]);
});
it("limits each hash and each IP independently", async () => {
  const send = post();
  for (let i = 0; i < 10; i++)
    expect((await send(request(hint, { "cf-connecting-ip": `ip-${i}` }))).status).toBe(
      i ? 200 : 202,
    );
  expect((await send(request(hint, { "cf-connecting-ip": "fresh-ip" }))).status).toBe(429);
  const perIp = post();
  for (let i = 0; i < 30; i++)
    await perIp(request({ ...hint, txHash: `0x${i.toString(16).padStart(64, "0")}` }));
  expect((await perIp(request({ ...hint, txHash: edges.missingHash }))).status).toBe(429);
});
it("concurrent hints with distinct intents coexist until chain evidence binds the hash", async () => {
  const send = post();
  const responses = await Promise.all([
    send(request()),
    send(request({ ...hint, intentId: "second" })),
  ]);
  expect(responses.map((r) => r.status)).toEqual([202, 202]);
  expect(store.listLatest(HINT_KIND, { maxAgeMs: 0 })).toHaveLength(2);
  await run();
  const bound = store.latest<StoredReceipt>(RECEIPTS_KIND, hint.txHash, { maxAgeMs: 0 })!.data;
  const otherId = bound.hint.intentId === hint.intentId ? "second" : hint.intentId;
  expect((await send(request({ ...hint, intentId: otherId }))).status).toBe(409);
  expect(
    store.latest<StoredHint>(HINT_KIND, receiptHintKey({ ...hint, intentId: otherId }), {
      maxAgeMs: 0,
    })!.data.state,
  ).toBe("rejected");
});
it("a verified transaction remains protected PENDING when receipt RPC is down, even after hint expiry", async () => {
  const original = engine.transactions;
  engine = {
    ...engine,
    transactions: {
      ...original,
      getReceipt: async () => {
        throw new Error("secret");
      },
    },
  };
  await post()(request());
  await expect(run()).rejects.toThrow("pending hashes retained");
  const options = { store, enabled: true, now: 1000 + HINT_TTL_MS + 1 };
  await expect(run(options.now)).rejects.toThrow("pending hashes retained");
  expect(store.latest(HINT_KIND, receiptHintKey(hint), { maxAgeMs: 0 })).toBeNull();
  expect(await loadReceipt(hint.txHash, options)).toMatchObject({
    status: "PENDING",
    txHash: hint.txHash,
  });
  expect(await loadQuality(options)).toMatchObject({ pendingCount: 1, report: { n: 0 } });
});
it("canonical public origin works behind an internal reverse-proxy URL and still rejects a foreign origin", async () => {
  const send = post({ trustedOrigin: "https://tally.test" });
  const body = JSON.stringify(hint);
  const req = (origin: string) =>
    new Request("http://localhost:3000/api/receipts", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body,
    });
  expect((await send(req("https://tally.test"))).status).toBe(202);
  expect((await send(req("https://evil.test"))).status).toBe(403);
});
it("MCP register exposes a read-only get_receipt lookup for verified, pending, stale, empty and disabled states", async () => {
  const { ToolRegistry } = await import("../../../../../packages/mcp/src/registry");
  const { register } = await import("../../../../../packages/mcp/src/tools/get-receipt");
  const disabled = new ToolRegistry();
  await register(disabled, engine, { enabled: false });
  expect(disabled.list()).toEqual([]);
  const registry = new ToolRegistry();
  await register(registry, engine, { store, enabled: true, now: () => 200_000 });
  expect(registry.list()[0]!.annotations?.readOnlyHint).toBe(true);
  expect((await registry.call("get_receipt", { txHash: "bad" })).isError).toBe(true);
  expect(
    JSON.parse((await registry.call("get_receipt", { txHash: hint.txHash })).content[0]!.text),
  ).toMatchObject({ state: "empty" });
  await post()(request());
  expect(
    JSON.parse((await registry.call("get_receipt", { txHash: hint.txHash })).content[0]!.text),
  ).toMatchObject({ state: "pending", stale: true, evidence: null });
  await run();
  expect(
    JSON.parse((await registry.call("get_receipt", { txHash: hint.txHash })).content[0]!.text),
  ).toMatchObject({
    state: "verified",
    stale: true,
    evidence: { baselineTrust: "client-hint", result: { status: "RECONCILED" } },
  });
});
it("registry failure retains the real mined receipt, marks incomplete evidence UNRECONCILED, and recovers without fabricated metadata", async () => {
  const original = engine;
  engine = {
    ...engine,
    ports: {
      ...engine.ports,
      registry: {
        tokensFor: async () => {
          throw new Error("registry down");
        },
      },
    },
  };
  await post()(request());
  await expect(run()).rejects.toThrow("reads unavailable");
  const vm = await loadReceipt(hint.txHash, { store, now: 1000, enabled: true });
  expect(vm).toMatchObject({
    status: "UNRECONCILED",
    ticker: null,
    evidence: { block: "125272679", gasUsed: "440520" },
  });
  expect(await loadQuality({ store, now: 1000, enabled: true })).toMatchObject({
    pendingCount: 0,
    report: { unreconciledCount: 1, n: 0 },
  });
  engine = original;
  await run(2000);
  expect((await loadReceipt(hint.txHash, { store, now: 2000, enabled: true })).status).toBe(
    "RECONCILED",
  );
});
it("synthetic unknown hints rotate through the bounded poll batch without renewing their expiry or age", async () => {
  const read = vi.fn(async (_hash: string) => null);
  engine = { ...engine, transactions: { ...engine.transactions, getTransaction: read } };
  for (let i = 0; i < 51; i++) {
    const hash =
      `0x${(BigInt(edges.missingHash) + BigInt(i)).toString(16).padStart(64, "0")}` as `0x${string}`;
    store.put({
      kind: HINT_KIND,
      key: receiptHintKey({ ...hint, txHash: hash }),
      source: "synthetic-browser-hint",
      observedAt: 1000 + i,
      data: {
        hint: { ...hint, txHash: hash },
        receivedAt: 1000 + i,
        expiresAt: 1000 + i + HINT_TTL_MS,
        state: "pending",
        reason: "Synthetic missing transaction",
      } satisfies StoredHint,
    });
  }
  await run(2000);
  expect(read).toHaveBeenCalledTimes(50);
  const firstBatch = new Set(read.mock.calls.map(([hash]) => hash));
  await run(3000);
  expect(new Set(read.mock.calls.map(([hash]) => hash)).size).toBe(51);
  expect(firstBatch.size).toBe(50);
  const latest = store.listLatest<StoredHint>(HINT_KIND, { maxAgeMs: 0, now: 3000, limit: 1000 });
  expect(latest.every((s) => s.data.expiresAt === s.observedAt + HINT_TTL_MS)).toBe(true);
  expect(latest.every((s) => s.ageMs >= 1950)).toBe(true);
});

it.each(["attacker-first", "sender-first"])(
  "same-hash pending hints: worker rejects the false sender and promotes the real sender (%s)",
  async (order) => {
    const original = engine.transactions;
    engine = { ...engine, transactions: { ...original, getTransaction: async () => null } };
    const attacker = {
      ...hint,
      intentId: "synthetic-attacker",
      user: edges.wrongSender as `0x${string}`,
    };
    const send = post();
    for (const candidate of order === "attacker-first" ? [attacker, hint] : [hint, attacker])
      expect((await send(request(candidate))).status).toBe(202);
    expect(store.listLatest(HINT_KIND, { maxAgeMs: 0 })).toHaveLength(2);
    expect(await loadQuality({ store, now: 1000 })).toMatchObject({
      pendingCount: 1,
      report: { n: 0 },
    });
    engine = { ...engine, transactions: original };
    await run();
    expect(
      store.latest<StoredHint>(HINT_KIND, receiptHintKey(attacker), { maxAgeMs: 0 })!.data,
    ).toMatchObject({
      state: "rejected",
      reason: "Transaction does not match supported signed intent",
    });
    expect(
      store.latest<StoredReceipt>(RECEIPTS_KIND, hint.txHash, { maxAgeMs: 0 })!.data,
    ).toMatchObject({
      hint: { intentId: hint.intentId, user: hint.user },
      transaction: { sender: hint.user },
      result: { status: "RECONCILED" },
    });
    expect(await loadQuality({ store, now: 1000 })).toMatchObject({ pendingCount: 0 });
    expect((await send(request({ ...hint, intentId: "another-intent" }))).status).toBe(409);
  },
);
it("an unverified sender claim for the same intent cannot refuse a later chain-verified sender", async () => {
  const original = engine.transactions;
  engine = { ...engine, transactions: { ...original, getTransaction: async () => null } };
  const send = post();
  expect((await send(request({ ...hint, user: edges.wrongSender }))).status).toBe(202);
  engine = { ...engine, transactions: original };
  expect((await send(request())).status).toBe(202);
  await run();
  expect(
    store.latest<StoredReceipt>(RECEIPTS_KIND, hint.txHash, { maxAgeMs: 0 })!.data.hint.user,
  ).toBe(hint.user);
});
it("the queue cap counts distinct hints even when they share a transaction hash", async () => {
  for (let i = 0; i < 1000; i++) {
    const candidate = { ...hint, intentId: `synthetic-${i}` };
    store.put({
      kind: HINT_KIND,
      key: receiptHintKey(candidate),
      source: "synthetic-browser-hint",
      observedAt: 1000,
      data: {
        hint: candidate,
        receivedAt: 1000,
        expiresAt: 1000 + HINT_TTL_MS,
        state: "pending",
        reason: "Synthetic queue capacity",
      } satisfies StoredHint,
    });
  }
  expect((await post()(request({ ...hint, txHash: edges.missingHash }))).status).toBe(503);
  expect(store.listLatest(HINT_KIND, { maxAgeMs: 0, limit: 1000 })).toHaveLength(1000);
});
it("evidence promoted during an ingestion read still refuses a different intent", async () => {
  await post()(request());
  const original = engine.transactions;
  const read = vi.fn(async (hash: string) => {
    await run();
    return original.getTransaction(hash);
  });
  const send = post({
    engine: async () => ({ ...engine, transactions: { ...original, getTransaction: read } }),
  });
  expect((await send(request({ ...hint, intentId: "racing-intent" }))).status).toBe(409);
  expect(read).toHaveBeenCalledOnce();
  expect(
    store.latest(HINT_KIND, receiptHintKey({ ...hint, intentId: "racing-intent" }), {
      maxAgeMs: 0,
    }),
  ).toBeNull();
});
