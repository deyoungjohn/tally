import { LIQUIDMESH_ROUTER, SHAREGUARD_DEPLOYED, USDT_BSC } from "@tally/config";
import type { Address } from "@tally/core";
import type { SnapshotStore } from "@tally/modkit";
import {
  HINT_KIND,
  HINT_TTL_MS,
  RECEIPTS_KIND,
  parseReceiptHint,
  receiptHintKey,
  verifySignedCall,
  verifySignedSellCall,
  type StoredHint,
  type StoredReceipt,
} from "@tally/mod-receipts";
import type { Engine } from "@tally/engine";

const MAX_BYTES = 16 * 1024;
interface Dependencies {
  enabled: () => boolean;
  engine: () => Promise<Engine>;
  store: () => SnapshotStore;
  now: () => number;
  onWarn: (message: string) => void;
  /** Canonical public origin when a reverse proxy supplies an internal request URL. */
  trustedOrigin?: string;
}
const response = (status: number, reason: string) =>
  Response.json({ reason }, { status, headers: { "Cache-Control": "no-store" } });
/** Each route instance bounds its rate-limit memory; persistence idempotence lives in SQLite. */
export function createReceiptPost(deps: Dependencies) {
  const limits = new Map<string, { count: number; until: number }>();
  function limit(key: string, max: number, now: number): boolean {
    for (const [k, v] of limits) if (v.until <= now) limits.delete(k);
    const v = limits.get(key);
    if (!v && limits.size >= 10_000) return false;
    if (v && v.count >= max) return false;
    limits.set(key, { count: (v?.count ?? 0) + 1, until: v?.until ?? now + 60_000 });
    return true;
  }
  return async function post(request: Request): Promise<Response> {
    if (!deps.enabled()) return response(404, "Receipts disabled");
    if (request.method !== "POST") return response(405, "POST required");
    const origin = request.headers.get("origin");
    if (
      !origin ||
      origin !== (deps.trustedOrigin ?? new URL(request.url).origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return response(403, "Same origin required");
    if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
      return response(415, "JSON required");
    const now = deps.now();
    // Cloudflare overwrites this header. Without that trusted proxy, conservatively share one bucket.
    const ip = request.headers.get("cf-connecting-ip") ?? "unidentified";
    if (!limit(`ip:${ip.slice(0, 64)}`, 30, now)) return response(429, "Receipt hint rate limit");
    const contentLength = request.headers.get("content-length");
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BYTES))
      return response(413, "Receipt hint too large");
    let value: unknown;
    try {
      const reader = request.body?.getReader();
      if (!reader) return response(400, "Body required");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          return response(413, "Receipt hint too large");
        }
        chunks.push(chunk);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return response(400, "Malformed receipt hint");
    }
    const hint = parseReceiptHint(value);
    if (!hint) return response(400, "Invalid receipt hint shape");
    if (!limit(`hash:${hint.txHash}`, 10, now)) return response(429, "Transaction hint rate limit");
    try {
      const store = deps.store();
      store.expire({ kind: HINT_KIND, olderThanMs: now - HINT_TTL_MS });
      const options = { maxAgeMs: HINT_TTL_MS, now };
      const key = receiptHintKey(hint);
      const evidence = store.latest<StoredReceipt>(RECEIPTS_KIND, hint.txHash, options);
      const previous = store.latest<StoredHint>(HINT_KIND, key, options);
      if (evidence)
        return evidence.data.hint.intentId === hint.intentId
          ? response(200, "Receipt already verified")
          : response(409, "Transaction already bound to another intent");
      if (previous && previous.data.expiresAt > now && previous.data.hint.user === hint.user)
        return response(200, previous.data.reason);
      let reason = "Transaction not yet available; awaiting chain verification";
      let state: StoredHint["state"] = "pending";
      try {
        const engine = await deps.engine();
        const tx = await engine.transactions.getTransaction(hint.txHash);
        if (tx) {
          try {
            if (hint.kind === "sell") {
              const tokens = await engine.ports.registry.tokensFor(hint.ticker);
              const stockAddr = tokens[0]?.address ?? hint.quote?.stock;
              let approveTarget: Address = LIQUIDMESH_ROUTER;
              if (stockAddr) {
                const guard = await (
                  engine as unknown as {
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
              verifySignedSellCall(tx, hint, tokens, approveTarget, LIQUIDMESH_ROUTER);
            } else {
              verifySignedCall(tx, hint, SHAREGUARD_DEPLOYED, USDT_BSC);
            }
          } catch {
            return response(422, "Transaction does not match a supported signed intent");
          }
          // Acceptance still stores only an untrusted hint; worker obtains the full receipt again.
          await engine.transactions.getReceipt(hint.txHash);
          state = "verified";
          reason = "Signed transaction verified; awaiting worker evidence";
        }
      } catch {
        deps.onWarn(
          "Receipt ingestion chain read unavailable; hint remains pending; provider details withheld",
        );
        reason = "Chain read unavailable; awaiting verification";
      }
      // A worker may have promoted evidence during the chain reads; hints never bind the hash.
      const promoted = store.latest<StoredReceipt>(RECEIPTS_KIND, hint.txHash, options);
      if (promoted)
        return promoted.data.hint.intentId === hint.intentId
          ? response(200, "Receipt already verified")
          : response(409, "Transaction already bound to another intent");
      const bound = store.latest<StoredHint>(HINT_KIND, key, options);
      if (bound && bound.data.expiresAt > now && bound.data.hint.user === hint.user)
        return response(200, bound.data.reason);
      if (!bound && store.listLatest(HINT_KIND, { ...options, limit: 1000 }).length >= 1000)
        return response(503, "Receipt hint queue full");
      store.put({
        kind: HINT_KIND,
        key,
        source: "untrusted-browser-hint",
        observedAt: now,
        data: {
          hint,
          receivedAt: now,
          expiresAt: now + HINT_TTL_MS,
          state,
          reason,
        } satisfies StoredHint,
      });
      return response(202, reason);
    } catch {
      deps.onWarn("Receipt hint storage unavailable; details withheld");
      return response(503, "Receipt hint storage unavailable");
    }
  };
}
