# WO-00 exit evidence

Recorded locally on Node v22.23.1, 2026-10-03. All data calls used committed fixtures; no live Binance, trading or RPC calls were made.

| Exit | Evidence |
| --- | --- |
| Snapshot put/latest/history, staleness, bigint, fallbacks, flags | `packages/modkit/src/index.test.ts`: 8 passing tests, including persisted cross-connection reads, marker escaping, aggregated errors and warning kinds. |
| Always-failing job keeps running; sibling stays healthy | `apps/worker/src/runner.test.ts`: 2 passing tests. Fake clock: failing flow runs at 0/20/60 ms, healthy guardian runs 11 times in 100 ms; abort stops both. Failure retains an old snapshot's time and last-good health. |
| Collector fixtures and additive engine APIs | `packages/binance/src/collectors.test.ts`: 4 passing tests; `packages/engine/src/collectors.test.ts`: 1 passing test; `apps/worker/src/collectors.test.ts`: 2 passing tests. Uses `P_rwa_price_batch`, `G_rwa_tokens_bstock`, `G_rwa_tokens_earnings` and the October 2 RWA fixture. |
| Isolated degraded card, enabled/off flags, worker health, stale health | `pnpm e2e:foundation`: 8 passed, 1 intentionally skipped (production gate tested in the production suite). Tests client and server failures, failed/stale health, no horizontal overflow, navigation and keyboard close. |
| Fixture CLI writes snapshots and API sees health | Foundation harness starts the exact `TALLY_FIXTURES=1 pnpm worker collect-registry` command against a temporary SQLite directory; waits for a persisted registry snapshot, then starts the separate standalone web process with that directory. API test sees `collect-registry: ok=true` and public flags. Supervised teardown uses SIGTERM and leaves no worker children. A separate manual CLI run exited 0 after SIGINT. |
| Existing production UI / region gate | `pnpm e2e`: 16 passed; foundation-only tests skipped by design. Includes 375/768/1280, reduced motion, keyboard, tunnel regression and production 404 for dev previews. |
| Existing tests and checks | `pnpm test`: 253 passed across the workspace. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, `git diff --check`: exit 0. Existing engine/parity tests and status mapping tests pass. |
| Native SQLite support | `.nvmrc` and CI select Node 22. Local `require('node:sqlite').DatabaseSync` opens an in-memory store without a flag. Runtime and tests leave experimental warnings visible. |

Screenshots from the foundation suite:

- [375 px](foundation-375.png)
- [768 px](foundation-768.png)
- [1280 px](foundation-1280.png)
- [Reduced motion](foundation-reduced-motion.png)
- [All module navigation entries enabled](foundation-all-nav.png)

The authenticated registry is deliberately labelled truncated, with no xStocks. The price collector leaves omitted entries missing with reasons and preserves the API's original price update time. Fixture times are not rewritten as current observations. On a primary outage, the old snapshot remains available with its age, while the collector health stays false.
