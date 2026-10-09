# WO-04 follow-up (urgent): the Radar page takes 15 s and freezes navigation

Same worktree and branch as WO-04 (fast-forward to `main` first). No new branch; commit, push, keep an open PR with the latest push.

## Symptoms (EC2, 9 Oct)
Opening Radar takes 15 seconds or more. While the Radar page is open, clicking another nav link takes 5 seconds or more. Radar refreshes itself every 60 s, so it does this repeatedly.

## Cause (read it, then prove it with numbers)
The Radar page reads `/api/vm/radar`, whose loader (`apps/web/modules/flow/view-model.ts`, `loadRadar`, and `loadFlow`) does this for every token in the registry (about 275):
1. `store.latest("flow", address)` decodes the whole `flow` snapshot. A `flow` payload is the entire merged trade tape and is about 1 to 1.6 MB (your own measurement: 1.05 MB, 92% trades; the EC2 store showed about 1.6 MB per row). That is roughly 300 to 450 MB of `JSON.parse` per request.
2. `aggregateFlow(flow.data, now)` then recomputes every rolling window over thousands of trades, again per token.
All of it runs synchronously on the web server's single JS thread. The page is slow, and every other request (a navigation, a quote) waits behind it: that is the 5 second nav delay. It got worse as the tapes grew, the registry grew, and more `flow` rows existed; the 8 Oct retention change shortened history but each token's latest row is still big.

## Do
1. **The page must not decode tapes.** The `flow` worker job already writes a small `flow-aggregate` row per token every minute (`aggregateFlow(snapshot.data, ctx.now())`, same `observedAt` and `source` as the tape). Make the radar list and the flow panels read `flow-aggregate` (and `flow-ghost`) instead of `flow`. Keep `stale`, `ageMs` and the source label exactly as now (take them from the aggregate row; they carry the tape's `observedAt`). The rolling windows will then be at most one worker interval (60 s) old: say so in a code comment and in the PR. The full tape is read only if a panel genuinely needs a trade list, and then only for the one ticker being opened.
2. **Single-flight cache for the radar view model** in the web process: key by the filter set, 20 second TTL, shared promise (use `TtlCache` from `@tally/core`; failures are not cached). Two tabs or the 60 s refresh must not start two computations.
3. **Measure and log**: one web-log line per `/api/vm/radar` request: milliseconds, tokens read, bytes decoded (counts and timings only). Report before and after for the fixture store and, in the PR, the numbers the chief engineer should expect on the EC2 (run `curl -H 'cf-ipcountry: KR' -s -o /dev/null -w '%{time_total}\n' localhost:3000/api/vm/radar`).
4. Keep every displayed value identical for the same snapshots, except the allowed up-to-one-minute window age. Existing view-model tests and e2e stay green; add tests that a radar request makes no `flow` reads (spy on the store), that the cache single-flights, and that a missing aggregate shows the existing "no flow observation" state.
5. Check `/api/vm/portfolio` and `/api/vm/statement` for the same pattern (a large snapshot decoded per request) and report what you find; fix only if it is the same small change.
6. Report the real `FULL=1 bash scripts/review-pack.sh <branch>` output.
