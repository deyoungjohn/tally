# Worker

Use Node 22.13 or newer (`node:sqlite` needs no flag). Experimental SQLite warnings remain visible.

Run `TALLY_DATA_DIR=/var/lib/tally pnpm worker collect-registry` and `TALLY_DATA_DIR=/var/lib/tally pnpm worker collect-prices` in separate processes. Start registry first. Use `TALLY_FIXTURES=1` for offline replay; no credentials or external requests are needed. With no data directory, storage defaults to `~/.local/share/tally/tally.db`. The web server must use the same data directory.

New jobs only add `src/jobs/<name>.ts`, exporting `job: WorkerJob` with `{ name, intervalMs, run(ctx) }`. There is no shared jobs index. `ctx` supplies the engine, store, health, warnings and clock. Loops are independent, failures update only their own health row and back off up to 15 minutes. SIGINT/SIGTERM stops scheduling and closes the store after any in-flight run finishes.

Snapshots use `registry/bsc` (raw authenticated RWA list including status), `prices/bsc` (batch), and `price/<lowercase address>` (individual price). The authenticated registry is incomplete and lacks xStocks; its notes say so. Prices retain the API's `tokenPriceUpdatedAt`, and fixture registry observations retain the recording time. Missing prices carry reasons. On a primary failure, the prior snapshot keeps its original timestamp and the collector stays unhealthy even when a cached snapshot is available.

`/api/modules/health` exposes `{ health, flags }` without credentials, with no caching. Module boundaries consider a failed health row or a row older than two minutes degraded. Job intervals above two minutes will need an explicit freshness policy in their module work order.

`pnpm e2e:foundation` uses its own supervised server on port 3101 with fixture collection, selected module flags and dev previews enabled. `pnpm e2e` remains the existing production/flag-off suite.
