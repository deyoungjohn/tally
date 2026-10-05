import {
  HINT_KIND,
  HINT_TTL_MS,
  RECEIPTS_KIND,
  RECEIPT_MAX_AGE_MS,
  verifySignedCall,
  promoteReceipt,
  verifyMinedTransaction,
  type StoredHint,
  type StoredReceipt,
} from "@tally/mod-receipts";
import type { WorkerJob } from "../runner";

/** Untrusted discovery is ephemeral; only verified chain transactions enter protected evidence. */
export const job: WorkerJob = {
  name: "receipts",
  intervalMs: 15_000,
  timeoutMs: 120_000,
  async run(ctx) {
    if (process.env.FEATURE_RECEIPTS !== "1") {
      if (process.env.FEATURE_QUALITY === "1")
        ctx.health.report("quality", { ok: true, now: ctx.now(), intervalMs: 15_000 });
      return;
    }
    const now = ctx.now();
    ctx.store.expire({ kind: HINT_KIND, olderThanMs: now - HINT_TTL_MS });
    const options = { maxAgeMs: RECEIPT_MAX_AGE_MS, now, limit: 1000 };
    const evidence = ctx.store.listLatest<StoredReceipt>(RECEIPTS_KIND, options);
    const byHash = new Map(evidence.map((s) => [s.key, s]));
    const targets = new Map(
      evidence
        .filter((s) => !s.data.chainReceipt || (s.data.kind === "swap" && !s.data.receipt))
        .map((s) => [s.key, s.data.hint]),
    );
    const hints = ctx.store.listLatest<StoredHint>(HINT_KIND, options);
    const hintByHash = new Map(hints.map((s) => [s.key, s]));
    for (const s of hints) {
      if (
        s.data.expiresAt <= now ||
        s.data.state === "rejected" ||
        (byHash.get(s.key)?.data.chainReceipt &&
          (byHash.get(s.key)?.data.kind === "approval" || byHash.get(s.key)?.data.receipt))
      )
        continue;
      targets.set(s.key, s.data.hint);
    }
    let failures = 0;
    const active = () => {
      if (ctx.signal?.aborted) throw new Error("Receipts run cancelled");
    };
    // Poll oldest verification first; a bounded run cannot let new arrivals starve pending evidence.
    const checkedAt = (hash: string) =>
      byHash.get(hash)?.data.lastCheckedAt ?? hintByHash.get(hash)?.data.lastCheckedAt ?? 0;
    const ordered = [...targets].sort(([a], [b]) => checkedAt(a) - checkedAt(b));
    for (const [hash, hint] of ordered.slice(0, 50)) {
      active();
      const previous = byHash.get(hash),
        previousHint = hintByHash.get(hash);
      // A failed read still advances polling order without renewing evidence age or hint expiry.
      if (previous) ctx.store.put({ ...previous, data: { ...previous.data, lastCheckedAt: now } });
      if (previousHint)
        ctx.store.put({ ...previousHint, data: { ...previousHint.data, lastCheckedAt: now } });
      try {
        const tx = await ctx.engine.transactions.getTransaction(hash);
        active();
        if (!tx) {
          ctx.onWarn(`Receipt ${hash}: transaction not available; hint remains pending`);
          continue;
        }
        let call;
        try {
          call = verifySignedCall(tx, hint);
        } catch {
          ctx.onWarn(`Receipt ${hash}: transaction rejected by signed-call verification`);
          const previous = ctx.store.latest<StoredHint>(HINT_KIND, hash, options);
          if (previous)
            ctx.store.put({
              ...previous,
              data: {
                ...previous.data,
                state: "rejected",
                reason: "Transaction does not match supported signed intent",
              },
            });
          continue;
        }
        if (!byHash.has(hash)) {
          // The signed transaction is already real evidence even if receipt/metadata RPC fails next.
          const data: StoredReceipt = {
            lastCheckedAt: now,
            kind: call.kind,
            transaction: tx,
            chainReceipt: null,
            receipt: null,
            result: null,
            hint,
            baselineTrust: "client-hint",
            verifiedAt: ctx.now(),
            verifiedFill: null,
            pendingReason: "Receipt or stock metadata verification pending",
          };
          ctx.store.put({
            kind: RECEIPTS_KIND,
            key: hash,
            source: process.env.TALLY_FIXTURES === "1" ? "recorded-chain" : "chain-rpc",
            observedAt: data.verifiedAt,
            data,
          });
        }
        const mined = await ctx.engine.transactions.getReceipt(hash);
        verifyMinedTransaction(tx, mined);
        active();
        if (mined)
          ctx.store.put({
            kind: RECEIPTS_KIND,
            key: hash,
            source: process.env.TALLY_FIXTURES === "1" ? "recorded-chain" : "chain-rpc",
            observedAt: ctx.now(),
            data: {
              lastCheckedAt: now,
              kind: call.kind,
              transaction: tx,
              chainReceipt: mined,
              receipt: null,
              result: null,
              hint,
              baselineTrust: "client-hint",
              verifiedAt: ctx.now(),
              verifiedFill: null,
              pendingReason: "Stock metadata verification unavailable",
            } satisfies StoredReceipt,
          });
        const tokens =
          call.kind === "swap" ? await ctx.engine.ports.registry.tokensFor(hint.ticker) : [];
        active();
        const token =
          call.kind === "swap"
            ? (tokens.find((t) => t.address.toLowerCase() === call.stock.toLowerCase()) ?? null)
            : null;
        const data = promoteReceipt(hint, tx, mined, call, token, ctx.now());
        data.lastCheckedAt = now;
        ctx.store.put({
          kind: RECEIPTS_KIND,
          key: hash,
          source: process.env.TALLY_FIXTURES === "1" ? "recorded-chain" : "chain-rpc",
          observedAt: data.verifiedAt,
          data,
        });
      } catch {
        active();
        failures++;
        ctx.onWarn(
          `Receipt ${hash}: read or metadata verification unavailable; pending state retained; provider details withheld`,
        );
      }
    }
    if (process.env.FEATURE_QUALITY === "1")
      ctx.health.report("quality", {
        ok: failures === 0,
        error: failures ? "Receipt evidence refresh unavailable" : undefined,
        now: ctx.now(),
        intervalMs: 15_000,
      });
    if (failures) throw new Error(`${failures} receipt reads unavailable; pending hashes retained`);
  },
};
