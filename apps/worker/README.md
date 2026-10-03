# Worker

Use Node 22.13 or newer (`node:sqlite` needs no flag). Experimental SQLite warnings remain visible.

Run `TALLY_DATA_DIR=/var/lib/tally pnpm worker collect-registry` and `TALLY_DATA_DIR=/var/lib/tally pnpm worker collect-prices` in separate processes. Start registry first. Use `TALLY_FIXTURES=1` for offline replay; no credentials or external requests are needed. With no data directory, storage defaults to `~/.local/share/tally/tally.db`. The web server must use the same data directory.

Set `TALLY_DATA_DIR` identically for web and every worker (EC2: `/var/lib/tally`).

New jobs only add `src/jobs/<name>.ts`, exporting `job: WorkerJob` with `{ name, intervalMs, timeoutMs?, run(ctx) }`. There is no shared jobs index. `ctx` supplies the engine, store, health, warnings and clock. Loops are independent, failures update only their own health row and back off up to 15 minutes. SIGINT/SIGTERM stops scheduling and closes the store after cancelling an in-flight run. Each run has a timeout (default `max(30 s, 2 × intervalMs)`); a timeout records unhealthy status and aborts `ctx.signal`. Jobs should observe that signal to release resources. Late writes through that run’s context are rejected.

Snapshots use `registry/bsc` (raw authenticated RWA list including status), `prices/bsc` (batch), and `price/<lowercase address>` (individual price). The authenticated registry is incomplete and lacks xStocks; its notes say so. Prices retain the API's `tokenPriceUpdatedAt`, and fixture registry observations retain the recording time. Missing prices carry reasons. On a primary failure, the prior snapshot keeps its original timestamp and the collector stays unhealthy even when a cached snapshot is available.

`/api/modules/health` exposes `{ health, flags }` without credentials, with no caching. Health rows record each job’s `intervalMs`. A row is stale after `3 × intervalMs`, with a 120 s fallback for legacy rows. A failed or stale run with a last-good observation keeps the content and shows an age notice; the loader and client context receive the health state. Never-succeeded workers and rendering/loading errors show a full degraded card.

`pnpm e2e:foundation` uses its own supervised server on port 3101 with fixture collection, selected module flags and dev previews enabled. `pnpm e2e` remains the existing production/flag-off suite.

Run `TALLY_DATA_DIR=/var/lib/tally pnpm worker prune` as a separate hourly loop. Retention is 24 h for per-token `price`, 2 h for aggregate `prices`, 6 h for `registry` and 7 d for other kinds, always retaining at least the newest observation per kind/key. Identical latest payloads at the same observation time are not appended again. Evidence kinds `receipt`, `receipts`, `decision`, `decisions`, `alert`, `alerts` are explicitly excluded from automatic pruning.

## WO-00 evidence

Snapshots, bigint round-trip, fallbacks and flags are covered in `packages/modkit/src/index.test.ts`. Retention and health cadence have their own tests. Worker tests cover repeated failures, sibling isolation, timeout/cancellation, stale snapshot preservation and protected evidence.

`pnpm e2e:foundation` starts the exact fixture registry CLI against a temporary SQLite directory and a separate standalone web process using that file. It verifies isolated client/server failures, failed-with-last-good content plus notices, never-succeeded cards, cadence, flag-off content, navigation and keyboard behavior. The production suite checks 375/768/1280, reduced motion, region/tunnel gates and hidden dev previews. Screenshots are uploaded as PR CI artifacts; no image binaries are tracked.
