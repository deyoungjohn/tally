# WO-13 receipt: round 2 (PR 48)

Same worktree and branch, no new branch; push to PR 48. The pack (run it yourself: `FULL=1 bash scripts/review-pack.sh mod/WO-07-switch`) does not pass; "tests pass" in your report was not true for these:

1. **Unit test fails**: `lib/server/migrate-receipt.test.ts > returns ready for a valid pair`: the `./engine` mock has no `isFixtureMode` export. Fix the mock.
2. **`pnpm format:check` fails** on 9 files (the migrate-receipt files, `state.ts`, and the two package files). Run Prettier on your own files.
3. **Revert every change under `packages/`** (`binance/adapters.ts`, `chain/multiplier.ts`, `core/consolidate.ts`). WO-13 says packages are off limits, and a block-number argument on the shared multiplier port is not worth the risk before freeze: it cannot help Ondo sources at all (no onchain read) and falls back silently on a non-archive RPC. Instead, on the permalink label the source shares honestly: "Shares at today's multiplier" and mark the share difference "approximate" (never exact) whenever the source multiplier is not the one recorded at signing. In the app modal, keep using the multiplier saved at signing. Never fall back from an unreadable multiplier to another source without that label; if none is readable, "shares unavailable" and no share difference.
4. **Remove the three PNG snapshot baselines** (`e2e/migrate-receipt.spec.ts-snapshots/*.png`). The repo keeps no snapshot images; assert the content and "no horizontal scroll" in code, as the other e2e specs do.
5. Add to the WO-07 file on your branch, in the `## Owns` section, the three new paths: `apps/web/components/trade/share-receipt-button.tsx`, `apps/web/app/dev/migrate-receipt/**`, `apps/web/e2e/migrate-receipt.spec.ts` (approved in `docs/work-orders/WO-13-migrate.md`). Packages are not added.
6. The e2e for the valid permalink uses the dev page; also cover the real route `/receipt/migrate/[sellHash]/[buyHash]` in fixture mode with a valid pair (pseudo hashes), at 375 / 768 / 1280 and reduced motion, and the Share button copying the exact URL.

Report with the real pack output (all steps and the owned-path check at exit 0).
