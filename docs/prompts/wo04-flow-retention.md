# WO-04 follow-up (urgent): the flow snapshots filled the EC2 disk

Same worktree and branch as WO-04 (fast-forward to `main`); no new branch; commit, push, keep an open PR.

## What happened
On 8 Oct the EC2 disk was full. `/var/lib/tally/tally.db` was 8.3 GB. By kind, over 8 hours: `flow` 7,561 rows = **7.76 GB (about 1 MB per row, about 275 MB per collection cycle)**; `flow-traders` 149 MB; `flow-holders` 147 MB; `registry` 136 MB; `flow-aggregate` 85 MB (26,845 rows). The prune job keeps everything for 7 days (`SNAPSHOT_RETENTION_MS.default`), and the readers only ever use the latest `flow` row per token (max age 15 minutes). Nothing was lost by the chief engineer's manual cleanup; the cause is retention, not a leak.

## Do
1. `apps/worker/src/jobs/prune.ts` (your WO's worker files; touch nothing else in the module): add retention for the flow kinds: `flow`, `flow-traders`, `flow-holders`, `flow-pools` 60 minutes; `flow-aggregate` 24 hours; keep `flow-progress`, `flow-attempt`, `flow-ghost` and the small registries on the default. Never touch the protected kinds (receipts, decisions, alerts, guardian-*); a test must prove the protected kinds survive a prune sweep.
2. Find out why one `flow` payload is about 1 MB and say in the PR what is in it. If a reader needs only a part of it (for example the aggregate or the top N holders and traders), propose the smaller shape in the PR description; implement it only if it changes no displayed number and the tests stay green. Otherwise leave the shape and report.
3. Make the prune run observable: log, per sweep, rows deleted by kind (counts only), through the worker's existing warn/log path. Update `docs/deployment.md` only if a command or flag changes.
4. Tests: retention per kind with a fake clock, protected kinds untouched, latest row of each key always kept even if older than the retention (so a slow collector does not blank the page).
5. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, then `bash scripts/review-pack.sh <branch>`; report the numbers (rows, MB per kind in fixture mode if you can measure).
