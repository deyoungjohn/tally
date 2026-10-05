import {
  DEFAULT_LIQUIDMESH_ROUTER,
  HINT_KIND,
  HINT_TTL_MS,
  RECEIPTS_KIND,
  RECEIPT_MAX_AGE_MS,
  receiptHintKey,
  verifySignedCall,
  verifySignedSellCall,
  promoteReceipt,
  promoteSellReceipt,
  verifyMinedTransaction,
  equalAddress,
  type ReceiptHint,
  type SellMultiplierEvidence,
  type StoredHint,
  type StoredReceipt,
} from "@tally/mod-receipts";
import type { WorkerJob } from "../runner";

type Address = `0x${string}`;
const LIQUIDMESH_ROUTER = DEFAULT_LIQUIDMESH_ROUTER;

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
        .filter(
          (s) =>
            !s.data.chainReceipt ||
            ((s.data.kind === "swap" || s.data.kind === "sell") && !s.data.receipt),
        )
        .map((s) => [receiptHintKey(s.data.hint), s.data.hint]),
    );
    const hints = ctx.store.listLatest<StoredHint>(HINT_KIND, options);
    const hintByKey = new Map(hints.map((s) => [s.key, s]));
    for (const s of hints) {
      const bound = byHash.get(s.data.hint.txHash);
      if (
        s.data.expiresAt <= now ||
        s.data.state === "rejected" ||
        (bound?.data.hint.intentId === s.data.hint.intentId &&
          bound.data.chainReceipt &&
          (bound.data.kind === "approval" ||
            bound.data.kind === "stock_approval" ||
            bound.data.receipt))
      )
        continue;
      // Preserve the original hint for already protected evidence; retain other candidates too.
      if (!targets.has(s.key)) targets.set(s.key, s.data.hint);
    }
    let failures = 0;
    const active = () => {
      if (ctx.signal?.aborted) throw new Error("Receipts run cancelled");
    };
    // Poll oldest verification first; a bounded run cannot let new arrivals starve pending evidence.
    const checkedAt = (key: string) => {
      const hint = targets.get(key)!;
      const bound = byHash.get(hint.txHash);
      return bound?.data.hint.intentId === hint.intentId
        ? (bound.data.lastCheckedAt ?? 0)
        : (hintByKey.get(key)?.data.lastCheckedAt ?? 0);
    };
    const ordered = [...targets].sort(([a], [b]) => checkedAt(a) - checkedAt(b));
    for (const [key, hint] of ordered.slice(0, 50)) {
      active();
      const hash = hint.txHash;
      const previous = ctx.store.latest<StoredReceipt>(RECEIPTS_KIND, hash, options),
        previousHint = hintByKey.get(key);
      // A failed read still advances polling order without renewing evidence age or hint expiry.
      if (previous?.data.hint.intentId === hint.intentId)
        ctx.store.put({ ...previous, data: { ...previous.data, lastCheckedAt: now } });
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
          if (hint.kind === "sell") {
            const tokens = await ctx.engine.ports.registry.tokensFor(hint.ticker);
            const stockAddr = tokens[0]?.address ?? hint.quote?.stock;
            let approveTarget: Address = LIQUIDMESH_ROUTER;
            if (stockAddr) {
              const guard = await (
                ctx.engine as unknown as {
                  trade?: {
                    chain?: {
                      readGuard?: (s: Address, r: Address) => Promise<{ approveTarget: Address }>;
                    };
                  };
                }
              ).trade?.chain
                ?.readGuard?.(stockAddr, LIQUIDMESH_ROUTER)
                .catch(() => null);
              if (guard?.approveTarget) approveTarget = guard.approveTarget;
            }
            call = verifySignedSellCall(tx, hint, tokens, approveTarget, LIQUIDMESH_ROUTER);
          } else {
            call = verifySignedCall(tx, hint);
          }
        } catch {
          ctx.onWarn(`Receipt ${hash}: transaction rejected by signed-call verification`);
          const previous = ctx.store.latest<StoredHint>(HINT_KIND, key, options);
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
        // Re-read the binding: an earlier candidate in this same batch may have been promoted.
        const bound = ctx.store.latest<StoredReceipt>(RECEIPTS_KIND, hash, options);
        if (bound && bound.data.hint.intentId !== hint.intentId) {
          ctx.onWarn(`Receipt ${hash}: evidence already bound to another intent`);
          const candidate = ctx.store.latest<StoredHint>(HINT_KIND, key, options);
          if (candidate)
            ctx.store.put({
              ...candidate,
              data: {
                ...candidate.data,
                state: "rejected",
                reason: "Transaction already bound to another intent",
              },
            });
          continue;
        }
        if (!bound) {
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
        let data: StoredReceipt;
        if (call.kind === "sell" || call.kind === "stock_approval") {
          const tokens = await ctx.engine.ports.registry.tokensFor(hint.ticker);
          const token = tokens.find((t) => equalAddress(t.address, call.stock)) ?? null;
          let multEvidence: SellMultiplierEvidence | null = null;
          try {
            const facts = await ctx.engine.facts(hint.ticker);
            const tokenFact = facts.find((f) => equalAddress(f.address, call.stock));
            if (tokenFact?.multiplier && tokenFact.multiplier.value > 0n) {
              multEvidence = {
                value: tokenFact.multiplier.value,
                source: tokenFact.multiplier.source,
                observedAt: ctx.now(),
              };
            }
          } catch {
            // multiplier unavailable
          }
          data = promoteSellReceipt(hint, tx, mined, call, token, multEvidence, ctx.now());
        } else {
          const tokens =
            call.kind === "swap" ? await ctx.engine.ports.registry.tokensFor(hint.ticker) : [];
          active();
          const token =
            call.kind === "swap"
              ? (tokens.find((t) => t.address.toLowerCase() === call.stock.toLowerCase()) ?? null)
              : null;
          data = promoteReceipt(hint as ReceiptHint, tx, mined, call, token, ctx.now());
        }
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
