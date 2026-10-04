# Flow (WO-04)

The pure module classifies stablecoin trades in bigint 1e18 shares and nominal
stablecoin dollars, labels bots/custody, aggregates 1h/24h/7d windows, and supplies
cleaned facts to the integrity grade. Business logic performs no I/O.

## Data and failure contracts

- `flow-registry/bsc`: the active set (at most 60 tokens), with resolved share
  multipliers and identities from the engine's registry/facts path. Discovery starts from the registry collector;
  each discovered ticker expands to all issuers via the engine.
- `radar-registry/bsc`: every discovered token, including tokens without a
  usable multiplier. A missing multiplier must not hide its grade.
- `radar/<lowercase token address>`: original engine integrity (including every check record),
  score, grade, reasons, raw 24h USD volume, active-set membership and its reason.
  Grades are available even when the token has no flow panel. Inactive rows
  refresh after 30 minutes and are stale after 60 minutes; their actual age is shown.
- `flow/<address>`: `FlowSnapshot` containing cleaned trades, labels, holder
  percentages, coverage, and missing-fact reasons. Shares and USD use 1e18.
- `flow-holders`, `flow-traders`, `flow-pools`: metadata refreshed every 10 min;
  failures warn and retain the original observation time or return unavailable.
- `flow-progress/<address>`: historical API cursor, confirmed chain cursor,
  coverage start, and last poll time. Chain reads are inclusive windows of at
  most 10,000 blocks; the next tail begins at the last processed block + 1.
- `flow-discovery/bsc`: per-ticker discovery/refresh attempts. Discovery reserves
  at most 10 seconds of the run budget; partial registries carry pending counts.
- `flow-attempt/<address>`: last service attempt, so an unavailable token cannot
  monopolize the queue. Service order is oldest attempt first (address breaks ties).
- `flow-collection/bsc`: per-run wall time, request counts, updated/deferred tokens,
  pending discovery, and full-pass progress/time. Counts are direct collector
  calls; `factsCalls` is separate because each facts call can make several reads.
  Retries and the engine's internal facts reads are not counted as direct calls.
- `flow-ghost` and `flow-aggregate`: module outputs for Guardian and other
  snapshot consumers. Both retain the source observation timestamp.

Only USDT/USDC/USD1/USDon **addresses** are accepted as counterparts. API prices
are recomputed from the two amounts, ignoring the API's quoted `price`/`volume`.
Dollar values assume the allow-listed dollar token's nominal unit; this is not a
stablecoin peg-price feed. Bot-labelled trades are excluded from real flow and
volume. Custody is excluded from top-ten concentration, which remains a
percentage of the original supply (not a renormalized percentage).

The user's EC2 run on 2026-10-04 returned `holdingPercent: null` on top-trader
rows. The shared holder/trader schema accepts that shape. Percentage-based
custody detection skips unknown percentages (configured custody lists still
apply); bot turnover detection does not depend on a percentage. If any row on
the holders endpoint has a null percentage, concentration is null with
`Holder supply percentage unavailable; concentration unknown`, rather than a
sum over only the available percentages. The collector regression test applies
this user-observed shape to a recorded row without editing recorded evidence.

Collection has a 45-second wall-clock budget checked between calls. An in-flight
read can finish after the deadline; no next token/page/metadata read starts once
it is reached. The job runs at a 60-second interval with a 120-second timeout.
The runner waits the interval after completion, so this is not a fixed one-minute
start cadence. Cached flow/Radar registries and fresh per-ticker grades are reused
for 10 minutes; active facts refresh only after 10 minutes; inactive facts only after 30 minutes.
Even when an active sibling shares a ticker, its inactive sibling keeps its
original grade observation until the 30-minute refresh is due. Deferred tokens
are serviced first on the next run.

API history initially uses at most ten pages per token. Later polls read one
newest page; an unfinished initial history scan resumes at its saved cursor with
at most one extra history page per run. Completing the backfill never starts a
second ten-page scan. A tail page that does not overlap the previous observation
reports incomplete history. Partially covered windows have unknown cleaned USD
volume. Missing or stale top-trader metadata has the independent reason
`Top-trader labels unavailable; volume not cleaned`, without changing the
recorded history coverage.

The active set is ranked by **raw** 24h USD volume read from the existing engine
facts (stored as `rawVolume24hUsd` on each Radar row), with a $1,000 minimum and
a resolved multiplier for each selected token. It is capped at 60 tokens.
Positive holdings of registered wallets take priority and bypass the volume
minimum; addresses come from `wallet:active/bsc` and holdings from existing
`portfolio`/`statement` snapshots, with no extra wallet API calls. Missing/stale
holdings warn. More than 60 resolved held tokens is an explicit capacity error;
no held token is silently dropped and the hard cap is never exceeded.

Every discovered token keeps its original Radar grade. Inactive raw ghosts have
`no real market: under $1,000 24h`; missing volume, unresolved multipliers and
eligible tokens outside the cap have their own reasons. No flow panel is rendered
for inactive tokens, including an old flow snapshot left from prior membership.

A cached full pass needs N tail requests. Expiring all three metadata kinds adds
3N requests; initial history adds up to 9N extra requests, plus saved-cursor
continuation, facts reads and retries. At the 60-token cap, tails + metadata cost
780 direct calls per ten minutes (60 × 10 + 60 × 3), averaging 1.3 req/s before
facts and retries. The maximum one-time ten-page scan + cold metadata costs 780
calls (60 × 13). Facts refreshes and other jobs must fit the remaining shared
4 req/s quota. The former 605-token universe needed 2,420 tail + metadata requests
for even one pass, so it is no longer polled in full.

The fake-clock 60-token timing test uses 250 ms per collector request (4 req/s),
cold metadata and empty one-page tapes. It completes a full pass in two runs,
131.25 seconds including the runner's 60-second wait, making 285 direct calls
because the second run also polls already serviced tails. This is a scheduling
proof, not an EC2 measurement or a latency guarantee. Inspect `flow-active-set`
and `flow-collection` on EC2 for the actual size, request counts and pass times;
warm discovery before judging a stable active set. Initial discovery and failed
refreshes are explicitly marked as pending.

API failure uses `withFallback` to warn and read chain logs. Only known
stablecoin pool-to-wallet or wallet-to-pool endpoints are classified; mint/burn,
pool-to-pool, removed logs, configured routers, and intermediary hops are
excluded. A V4 pool ID is not a Transfer endpoint address and carries an
explicit limitation. General chain trades have null USD/price with
`price unavailable from chain logs`.

A last-known price screens whale _sizes_ only. No USD valuation is inferred
from it. At most 20 receipts are fetched across the entire run. A price requires
one matching stock Transfer and an unambiguous stablecoin leg crossing the same
pool in the opposite direction in the same successful transaction; otherwise
it stays null. Both-source failure leaves the last snapshot untouched and
reports the collector unhealthy. The API calls and facts reuse the engine's
single paced BinanceClient; no parallel clients or new dependencies are added.

## View model contract

`apps/web/modules/flow/view-model.ts` exports snapshot-only `loadFlow(ticker)`
and `loadRadar({ filters })`, `FlowPanelVM`, and `RadarVM`. Filters support issuer,
grade and ghost. Inactive tokens have no flow panel and carry their exclusion
reason. Radar grades use a 60-minute staleness limit; flow stays at 15 minutes. Missing data has an empty/error reason; age is explicit and
snapshots older than 15 minutes are stale. `displayFlow()` serializes financial
bigints to strings for client rendering. The unstyled `plain.tsx` renders grades
outside the flag-controlled `<ModuleBoundary module="flow">`. WO-12 owns the
product pages. `/dev/flow` requires the flow flag and the usual dev-preview gate.

`FEATURE_FLOW` defaults off. Start the separate read-only collector and module
processes only when enabling the module:

```sh
FEATURE_FLOW=1 pnpm worker collect-flow
FEATURE_FLOW=1 pnpm worker flow
```

The registry and price collectors must also be running. Live API collectors
require the user's existing authenticated environment and an allowed server
region. The EC2 env file needs `BSC_RPC_NODEREAL` (or `BSC_RPC_PRIMARY`) and,
for failover, `BSC_RPC_ANKR` (or the first comma-separated `BSC_RPC_FALLBACKS`
entry). Explicit Flow provider settings take precedence. Values may be full
provider URLs or provider credentials from the environment; the first provider
is tried before the second. No configured provider warns once at construction.
Errors and warnings never include URLs.

## Radar grade contract

`checkGhost()` accepts cleaned 24h volume and last real trade age. The age limit
is configurable (default 3 days); volume < $1,000 or excessive age is a ghost.
Unknown or stale cleaned data skips the check with a reason.
`extendIntegrity(base, input)` replaces the existing raw-volume check directly
on the original check records, retaining every other penalty and handling scores
clamped at zero. Radar stores those original records and calls this function;
there is no summary-based grading implementation.

The grade basis is labelled `cleaned flow` when the replacement ran, or `engine`
when flow is disabled, absent or skipped. The quote/buy path and core integrity
code remain unchanged. Radar and `/quote` can therefore show different grades.
Future wiring would call `extendIntegrity(base, ghostInput(...))`; wiring that
verdict into execution gating needs a separate money-path review. The optional
port proposal is deferred, not an instruction to alter the quote path now.

## Evidence and checks

- `spike/results/module_probes_20261003T130122Z.json`: recorded market legs,
  holder/top-trader labels and known pools. Cursor pages beyond the recording
  fail explicitly; fixture replay never fabricates complete history.
- `spike/results/flow_logs_20261004T120914Z.json`: read-only NodeReal capture,
  10,000 blocks, 33,259 NVDAB + 129 NVDAon Transfers, 20 largest distinct-tx
  receipts per token. No URLs/credentials in the recording. Captured ambiguous
  whale receipts remain unpriced. This NVDAon window has no directly
  classifiable known-pool/wallet prints; an empty tape is honest.
- `src/index.test.ts`: classifier/labels/aggregate/ghost tests, recorded fallback,
  both-source failure, cursor pagination, receipt cap, pool direction/hop
  exclusions, budget resumption, one-page tails, cached discovery, active-set selection,
  raw-ghost grade retention, wallet-held inclusion, missing-label reasons,
  and the exact grade implementation.
- `apps/web/modules/flow/view-model.test.ts`: empty/error states, age >15 min,
  chain-log label and missing price, flag-off grade rendering, filters, and parity with `extendIntegrity` for ghost/non-ghost/clamped bases.

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @tally/web exec playwright test --config modules/flow/playwright.config.ts
pnpm e2e:foundation
```

The retained `preview.spec.ts` suite regenerates 375/768/1280 px screenshots at
normal and reduced motion under `apps/web/test-results/flow-preview/`. Attach
these artifacts to the PR; screenshots and terminal transcripts are not committed. Set `PLAYWRIGHT_CHROMIUM_PATH` to a working
local Chromium only if Playwright's bundled browser is unavailable.

The read-only recorder can be repeated with the provider already in the
process environment (never paste a URL/key into a command or chat):

```sh
python3 spike/record_flow_logs.py --blocks 10000
```
