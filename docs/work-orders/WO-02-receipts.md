# WO-02 Receipts + Execution quality report

| | |
|---|---|
| Agent | C (Codex #2) |
| Branch | `mod/WO-02-receipts` for both slices (slice A merged; slice B starts fresh from main under the same name, only after the WO-01 follow-up `onStage` merges; WO-00 and M3 base already merged) |
| Read first | `MODULES.md` §4.1 and `docs/archive/MODULES-v1.md` §4, `IDEAS.md` F6 and F11, blueprint §7.6 |

## Owns

- `packages/mod-receipts/**`
- `apps/worker/src/jobs/receipts.ts` (reconciles `PENDING` receipts)
- `apps/web/modules/receipts/**`, `apps/web/modules/quality/**`, `apps/web/app/dev/receipts/**`, `apps/web/app/dev/quality/**`
- `packages/mcp/src/tools/get-receipt.ts`
- Approved 2026-10-04 by the chief engineer (security review pending, see below): a new ingestion route `apps/web/app/api/receipts/route.ts` (+ `route.test.ts`) and a client recorder component `apps/web/modules/receipts/recorder.tsx` that subscribes to WO-01's stage events (`subscribeTradeStage(listener, { replay: true })`) and posts them. Route rules: POST only, same-origin, body ≤ 16 KB, strict hand-written shape guards, `FEATURE_RECEIPTS` off → 404. Everything the browser sends is an untrusted **hint**: store it as kind `receipt-hint` (not a protected evidence kind, pruned) keyed by txHash; before accepting, verify the hash on chain (`engine.chain.transactionReceipt`, or not yet mined → keep as a pending hint with a short expiry), require the transaction to go to the deployed ShareGuard (or be the USDT approval) and `from` = the intent's user. The worker job promotes verified hints to kind `receipts` (protected) and fills every realized field only from chain logs, never from client data. Rate-limit per IP and per hash, idempotent per (txHash, intentId). WO-12 mounts `<ReceiptRecorder />` once in the root layout when the flag is on (a request, not a WO-02 edit). The orchestrator reviews this route's security before merge (unauthenticated write endpoint; escalation reassigned from Claude by the chief engineer, 2026-10-05); Opus 5.5 sees it in the Fri 9 whole-repo review.
- Approved 2026-10-05, **additive only**, for slice B's ingestion security and worker discovery (the owning work orders are merged or about to merge; no two open work orders own these files; start after WO-01 and WO-05 have merged and rebase first):
  - Read-only transaction access: a new file `packages/chain/src/transactions.ts` (+ test) exporting a reader with `getTransaction(hash)` and `getReceipt(hash)` returning sender, destination, value, input selector, block number (null while pending), gas limit, gas used, status and logs; failover and URL/key redaction exactly as in `packages/chain/src/logs.ts` (reuse `BSC_RPC_NODEREAL`/`BSC_RPC_ANKR` with the `PRIMARY`/`FALLBACKS` fallback, warn once when none is configured); one export line in `packages/chain/src/index.ts`. Do **not** change `FlowChain` or `engine.chain`.
  - Engine exposure: a new file `packages/engine/src/transactions-fixture.ts` (fixture reader backed by the newest `spike/results/receipt_vectors_*.json`, read-only) and one accessor line in `packages/engine/src/engine.ts` (`engine.transactions`). Expect a trivial rebase conflict with WO-05/WO-06 on that file.
  - modkit (`packages/modkit/src/index.ts`, + test): new `SnapshotStore` methods only: `listLatest(kind, { maxAgeMs, now?, limit? })` (latest row per key, `limit` ≤ 1000, default 200) and `expire({ kind, olderThanMs })` which deletes rows of a kind older than the cutoff and **throws for any kind in `EVIDENCE_SNAPSHOT_KINDS`**. No existing signature changes (`SnapshotStore` has no other implementer).
  - Dependencies: `@tally/modkit` and `@tally/mod-receipts` as `workspace:*` in `packages/mcp/package.json` plus the matching `pnpm-lock.yaml` importer lines, for `get-receipt.ts` only.
- Approved 2026-10-03: `spike/record_receipt_vectors.py`, `spike/results/receipt_vectors_*.json` (new files only; read-only recorder of F6/F11 on-chain receipts)

## Tasks

**Slice A (pure, start now):**
1. Types: `Intent`, `QuoteRecord`, `SimulationRecord`, `Conversion` (multiplier, source, observationId, observedAt), `Realized` (txHash, block, status, `Guarded` event fields, Transfer logs of this tx), `Receipt`.
2. `reconcile(receipt): { status, diffVsQuoteBps, diffVsSimBps, notes[] }` with the five statuses and rules in §4.1. Raw token units authoritative; shares derived.
3. Decoders: ShareGuard `Guarded` event and revert reasons (`InsufficientShares`, `TokenPaused`, `FailedInnerCall`, …) from the ABI in `contracts/out` or a checked-in ABI JSON.
4. `qualityReport(receipts, referencePrices)`: per issuer and per route length: n, fill rate, median/p90 diff vs quote, vs simulation, vs US reference per share. Returns `insufficient: true` when n < 5.
5. Tests: the three F6 vectors (−0.51% → `RECONCILED_WITH_DIFFERENCE`, +0.01% → `RECONCILED`, out-of-gas → `FAILED`), wrong decimals, later multiplier change (receipt unchanged), missing transfer evidence (→ `UNRECONCILED`).

**Slice B (blocked until WO-01 M3 follow-up `onStage` merges; the merged M3 base alone does not unblock it):**
6. Subscribe to WO-01's stage events through the `ReceiptRecorder` client component and the ingestion route above (browser → untrusted hint → chain-verified → worker promotes to kind `receipts`, key txHash). A resumed receipt must arrive too (needs WO-01's replay buffer).
7. Worker job: fetch receipts for `PENDING` hashes over NodeReal with fallback; never mark failed on RPC errors.
8. View models + plain components (UI split: you ship the logic and a typed view model plus a plain, unstyled component in `apps/web/modules/<name>/`; the UI agent (WO-12, Sonnet) builds the real page from your view model. Don't style, don't create pages outside `apps/web/app/dev/<name>/`.): `ReceiptVM` (ladder stages Quoted → Simulated → Received with values, status badge, provenance line, evidence drawer data), `ActivityVM` (list for Portfolio → Activity), `QualityVM` (per-issuer and per-route rows, `insufficient`, pending count). The UI agent builds `/receipt/[txHash]`, the Activity tab and `/quality`.
9. MCP tool `get_receipt(txHash)`.
   Contract with WO-05 (decided 2026-10-04): `packages/mcp/src/tools/get-receipt.ts` must `export async function register(registry: ToolRegistry, engine: Engine)` (types from `packages/mcp/src/registry.ts`) and call `registry.add(definition, handler)`. WO-05's loader warns and skips a file that is malformed, so a bad file never takes the MCP server down.

## Exit checks

- [ ] Slice A tests above, all from recorded data (no network).
- [ ] RPC down (mocked) → receipt stays `PENDING` with the hash; quality page excludes and counts pending.
- [ ] `QualityVM` reports `insufficient: true` at n < 5 and the plain component says so; view-model unit tests for empty, pending-only and stale states.
- [ ] Flag `FEATURE_RECEIPTS` / `FEATURE_QUALITY` off → nothing renders; trade flow unaffected.

## Out of scope

Tax/accounting, dividends, an on-chain receipt registry.
