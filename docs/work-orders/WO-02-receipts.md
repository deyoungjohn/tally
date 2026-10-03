# WO-02 Receipts + Execution quality report

| | |
|---|---|
| Agent | C (Codex #2) |
| Branch | `mod/WO-02-receipts` (slice A: `mod/WO-02-receipts-a` pure logic, can start now; slice B after WO-00 + WO-01 merge) |
| Read first | `MODULES.md` §4.1 and `docs/archive/MODULES-v1.md` §4, `IDEAS.md` F6 and F11, blueprint §7.6 |

## Owns

- `packages/mod-receipts/**`
- `apps/worker/src/jobs/receipts.ts` (reconciles `PENDING` receipts)
- `apps/web/app/receipt/[txHash]/**`, `apps/web/app/quality/**`, `apps/web/components/receipts/**`
- `packages/mcp/src/tools/get-receipt.ts`

## Tasks

**Slice A (pure, start now):**
1. Types: `Intent`, `QuoteRecord`, `SimulationRecord`, `Conversion` (multiplier, source, observationId, observedAt), `Realized` (txHash, block, status, `Guarded` event fields, Transfer logs of this tx), `Receipt`.
2. `reconcile(receipt): { status, diffVsQuoteBps, diffVsSimBps, notes[] }` with the five statuses and rules in §4.1. Raw token units authoritative; shares derived.
3. Decoders: ShareGuard `Guarded` event and revert reasons (`InsufficientShares`, `TokenPaused`, `FailedInnerCall`, …) from the ABI in `contracts/out` or a checked-in ABI JSON.
4. `qualityReport(receipts, referencePrices)`: per issuer and per route length: n, fill rate, median/p90 diff vs quote, vs simulation, vs US reference per share. Returns `insufficient: true` when n < 5.
5. Tests: the three F6 vectors (−0.51% → `RECONCILED_WITH_DIFFERENCE`, +0.01% → `RECONCILED`, out-of-gas → `FAILED`), wrong decimals, later multiplier change (receipt unchanged), missing transfer evidence (→ `UNRECONCILED`).

**Slice B (after WO-00 and WO-01):**
6. Subscribe to WO-01's `onStage` events; persist via `SnapshotStore` (kind `receipt`, key txHash or intent id).
7. Worker job: fetch receipts for `PENDING` hashes over NodeReal with fallback; never mark failed on RPC errors.
8. UI: receipt card (ladder Quoted → Simulated → Received, provenance line, evidence drawer), `/receipt/[txHash]` share link, Portfolio → Activity list component exported for WO-03, `/quality` page.
9. MCP tool `get_receipt(txHash)`.

## Exit checks

- [ ] Slice A tests above, all from recorded data (no network).
- [ ] RPC down (mocked) → receipt stays `PENDING` with the hash; quality page excludes and counts pending.
- [ ] `/quality` shows "not enough fills yet" honestly at n < 5; renders correctly at 375/768/1280.
- [ ] Flag `FEATURE_RECEIPTS` / `FEATURE_QUALITY` off → nothing renders; trade flow unaffected.

## Out of scope

Tax/accounting, dividends, an on-chain receipt registry.
