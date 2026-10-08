# WO-00 follow-up (urgent): workers die on "database is locked"; prices never collect

You are Agent 00 (foundation owner: modkit, worker runner, collect-prices). Same worktree and branch as WO-00 (fast-forward to `main` first); no new branch; commit, push, keep an open PR with the latest push. Touch only the files named here.

## What happened on the EC2 (8 Oct)
Right after a restart, four workers (`receipts`, `collect-prices`, `collect-flow`, `flow`) died; their logs end with `database is locked`. Cause, read from the code:
1. `apps/worker/src/runner.ts` `runJobs`: `context.health.report(...)` runs inside the `try` after a successful job and again inside the `catch`. A `SQLITE_BUSY` from that write throws out of the `catch`, rejects `Promise.all`, and `cli.ts` prints the message and exits. One lock timeout kills the whole worker.
2. The lock itself: SQLite allows one writer. The store sets `busy_timeout = 5000`; the first `prune` sweep after a restart deletes gigabytes of flow rows in one statement and holds the write lock for much longer than 5 s, so every other worker's write times out.
3. Separately, `collect-prices` has never produced a `price`/`prices` row on the EC2: its log shows `primary failed: non-JSON response (HTTP 414)` (URI too long). `packages/binance/src/collectors.ts` `prices()` sends up to 100 comma-separated addresses in the query string (about 4.3 KB); the server answers 414. The fallback then says "No previous prices/bsc snapshot".

## Do
1. **Runner**: a failed health write must never end the worker. Wrap both `context.health.report` calls in a helper that catches and logs (`onWarn`) and retries once after a short wait; the job loop continues. Same for any store write in the loop's own bookkeeping. Add a test with a store whose `report` throws `database is locked` three times: the worker keeps running and recovers.
2. **modkit `openStore`** (only the pragma line): `busy_timeout = 30000`. Add a test that two connections contend and the second waits rather than failing within 5 s.
3. **Prune in small steps** (`packages/modkit/src/index.ts`, the `prune` function only, tightening behaviour, plus its test): delete in chunks of 200 rows per statement (loop until none left, return the total), and yield briefly between chunks (`await` not possible in a sync function: keep it synchronous but commit per chunk, so each chunk holds the lock for milliseconds, not seconds). Rows kept and protected kinds stay exactly the same; the existing prune and evidence tests must pass unchanged.
4. **collect-prices**: change the batch size from 100 to 20 in `apps/worker/src/jobs/collect-prices.ts` (about 0.9 KB of query string) and make `packages/binance/src/collectors.ts` `prices()` enforce the same cap with a clear error (this one constant is approved; no other change in that file). If the 414 comes from a different cause than URL length, the log will show it: tell the chief engineer which command to run on the EC2 to test (`curl` is not allowed to print keys; use the recorder style). Keep the fixture-mode behaviour identical.
5. A single failed source must not wipe an old snapshot; do not change `collect()` beyond this.

## Report
`pnpm typecheck`, `lint`, `format:check`, `test`, then `FULL=1 bash scripts/review-pack.sh <branch>` on a quiet machine, paste the real output (every step and the owned-path check at exit 0). In the PR: what the chief engineer does after merging (`./deploy/restart.sh --update`, then `--status`: all wanted services `running`, and `prices` rows present: `sudo sqlite3 -readonly /var/lib/tally/tally.db "SELECT kind,count(*) FROM snapshots WHERE kind IN ('price','prices') GROUP BY kind;"`).
