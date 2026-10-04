# Flow (WO-04)

The pure module classifies stablecoin trades in bigint 1e18 shares and nominal
stablecoin dollars, labels bots/custody, aggregates 1h/24h/7d windows, and supplies
cleaned facts to the integrity grade. Business logic performs no I/O.

## Data and failure contracts

- `flow-registry/bsc`: resolved share multipliers and token identities from the
  engine's registry/facts path. Discovery starts from the registry collector;
  each discovered ticker expands to all issuers via the engine.
- `radar-registry/bsc`: every discovered token, including tokens without a
  usable multiplier. A missing multiplier must not hide its grade.
- `radar/<lowercase token address>`: original engine score, grade, reasons and
  the existing ghost deduction. Grades are available to the view model even
  when its flow panel is disabled.
- `flow/<address>`: `FlowSnapshot` containing cleaned trades, labels, holder
  percentages, coverage, and missing-fact reasons. Shares and USD use 1e18.
- `flow-holders`, `flow-traders`, `flow-pools`: metadata refreshed every 10 min;
  failures warn and retain the original observation time or return unavailable.
- `flow-progress/<address>`: historical API cursor, confirmed chain cursor,
  coverage start, and last poll time. Chain reads are inclusive windows of at
  most 10,000 blocks; the next tail begins at the last processed block + 1.
- `flow-ghost` and `flow-aggregate`: module outputs for Guardian and other
  snapshot consumers. Both retain the source observation timestamp.

Only USDT/USDC/USD1/USDon **addresses** are accepted as counterparts. API prices
are recomputed from the two amounts, ignoring the API's quoted `price`/`volume`.
Dollar values assume the allow-listed dollar token's nominal unit; this is not a
stablecoin peg-price feed. Bot-labelled trades are excluded from real flow and
volume. Custody is excluded from top-ten concentration, which remains a
percentage of the original supply (not a renormalized percentage).

API history is paginated with a default budget of ten pages per token per run.
A saved cursor continues historical backfill after the new tail overlaps the
previous poll. A partially covered window carries a reason, and cleaned USD
volume stays unknown until its whole window is covered and priced. Metadata
failures also prevent a cleaned-volume ghost verdict.

API failure uses `withFallback` to warn and read chain logs. Only known
stablecoin pool-to-wallet or wallet-to-pool endpoints are classified; mint/burn,
pool-to-pool, removed logs, configured routers, and intermediary hops are
excluded. A V4 pool ID is not a Transfer endpoint address and carries an
explicit limitation. General chain trades have null USD/price with
`price unavailable from chain logs`.

A last-known price screens whale *sizes* only. No USD valuation is inferred
from it. At most 20 receipts are fetched across the entire run. A price requires
one matching stock Transfer and an unambiguous stablecoin leg crossing the same
pool in the opposite direction in the same successful transaction; otherwise
it stays null. Both-source failure leaves the last snapshot untouched and
reports the collector unhealthy. The API calls and facts reuse the engine's
single paced BinanceClient; no parallel clients or new dependencies are added.

## View model contract

`apps/web/modules/flow/view-model.ts` exports snapshot-only `loadFlow(ticker)`
and `loadRadar({ filters })`, `FlowPanelVM`, and `RadarVM`. Filters support issuer,
grade and ghost. Missing data has an empty/error reason; age is explicit and
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
region. `BSC_RPC_NODEREAL` and `BSC_RPC_ANKR` accept full provider URLs or provider
credentials from the environment; NodeReal is tried first, then Ankr. Errors
never include the URL.

## Grade wiring for the orchestrator

`checkGhost()` accepts cleaned 24h volume and last real trade age. The age limit
is configurable (default 3 days); volume < $1,000 or excessive age is a ghost.
Unknown or stale cleaned data skips the check with a reason.
`extendIntegrity(base, input)` is the pure implementation for an injected port;
it replaces the existing raw-volume check without double-counting its penalty
or retaining an obsolete ghost reason. `gradeWithFlow()` adapts the summary
shape used by the Radar view model.

No core integrity code is edited. Proposed one-line wiring after computing the
base integrity in core, with an optional port supplied by the orchestrator:

```ts
integrity = ports.flowGrade?.(integrity, token.address) ?? integrity;
```

The engine-side port adapter should read the already-loaded flow snapshot,
build `ghostInput(aggregateFlow(snapshot.data, now), snapshot.stale)`, then call
`extendIntegrity`. A missing snapshot returns the original grade and records a
missing-flow reason. The optional port declaration and actual core/engine
wiring belong to the orchestrator; WO-04 supplies the pure implementation and
snapshot contract.

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
  exclusions, and the injected grade implementation.
- `apps/web/modules/flow/view-model.test.ts`: empty/error states, age >15 min,
  chain-log label and missing price, flag-off grade rendering, and filters.

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @tally/web exec playwright test --config modules/flow/playwright.config.ts
pnpm e2e:foundation
```

The preview suite captures 375/768/1280 px at normal and reduced motion. See
`apps/web/modules/flow/evidence/`. Set `PLAYWRIGHT_CHROMIUM_PATH` to a working
local Chromium only if Playwright's bundled browser is unavailable.

The read-only recorder can be repeated with the provider already in the
process environment (never paste a URL/key into a command or chat):

```sh
python3 spike/record_flow_logs.py --blocks 10000
```
