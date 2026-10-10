# Receipts — WO-02

Pure TypeScript: `reconcile(receipt)`, `qualityReport(receipts, referencePrices)`,
`decodeGuarded(log)`, `decodeTransfer(log)` and `decodeRevert(data)`. No I/O,
external dependencies, buy-flow changes or contract changes.

## Reconciliation

Token raw units are authoritative. `receiptShares` converts them with the
receipt's frozen `Conversion`: `tokensRaw × multiplierE18 / 10^tokenDecimals`.
Share amounts remain bigint at 1e18. The ShareGuard v1 path additionally requires
18 token decimals, matching its deployed conversion formula.

- `PENDING`: no mined receipt; the transaction hash remains on the input receipt.
- `FAILED`: mined revert, including decoded custom errors when revert bytes exist.
  Standard RPC receipts do not contain revert reasons. A historical replay's
  failure is supporting evidence, not proof that every failure has that cause.
- `UNRECONCILED`: missing/wrong asset, recipient, decimals, conversion, transaction
  or Transfer evidence; contradictory Guarded output; or output below the minimum.
- `RECONCILED`: same asset, above the signed minimum, within **exactly 1 basis point
  (0.01%)** of simulation. The threshold uses bigint, before display rounding.
- `RECONCILED_WITH_DIFFERENCE`: evidence agrees and the minimum holds, but the
  difference exceeds that threshold. No cause is guessed.

When `simulation` is null, `simulationMissingReason` is mandatory. The quote at
send substitutes for simulation for the status comparison, with the exact note
`compared with quote; no simulation recorded`. `diffVsSimBps` stays null.
Successful guarded receipts require exactly one Guarded event from the signed
guard, matching intent and route, and matching this transaction's net output
Transfers to the recipient. Foreign, removed and duplicate logs cannot explain a
fill. Net spend uses the input token's Transfers, deducting refunds.

No current clock or latest multiplier is consulted. Old evidence keeps its
historical interpretation. Snapshot age/health and RPC fallbacks belong to the
Slice B I/O layer. A missing original timestamp is explicitly null with a reason;
the original script's run-start time is not invented as an observation time.

## Recorded proof

New recording: `spike/results/receipt_vectors_20261003T170030619036Z.json`.
Includes full transactions, mined receipts/logs/status/gas/block and historical
`eth_call` at block minus one using original calldata and gas cap. Four historical
calls succeeded; F6's out-of-gas vector returned `0x1425ea42` (`FailedInnerCall`).
The originals remain read-only. The fixture adapter joins these logs with the
original F6/F11 quote and multiplier summaries.

| Vector | Quote at send (raw tokens) | Received (raw tokens) | Difference (bps, truncated to 4 decimals) | Status |
| --- | ---: | ---: | ---: | --- |
| F6 NVDAB | 26089600773159179 | 25957237393326391 | -50.7341 | RECONCILED_WITH_DIFFERENCE |
| F6 NVDAon | 26090483888849726 | 26092638158534866 | +0.8256 | RECONCILED |
| F6 out-of-gas NVDAon | unavailable | reverted | unavailable | FAILED |
| F11 guarded NVDAB | 25654607700643592 | 25654736067444806 | +0.0500 | RECONCILED |
| F11 guarded NVDAon | 25660904727472955 | 25660879351478947 | -0.0098 | RECONCILED |

The F6 NVDAon percentage is **+0.0082569173%** against the quote at send, which
rounds to the F6 narrative's +0.01%. The exact 0.01% rule therefore gives
`RECONCILED`. The initial quote is retained in its original file, but the later
at-send quote is the comparison baseline.

Original simulations are absent, including the guard's original simulation.
Tests separately exercise the recorded historical F11 reconstructions: the guard
returns shares, whose raw token preimage is uniquely recovered and verified for
these multipliers. They are labelled `historical-eth_call`, never represented as
original simulations. F6 successful router calls return `0x`, so no output amount
is inferred from them.

`src/fixtures/edge-cases.json` is separate, and every fixture object has
`synthetic: true`. Its test adapter derives wrong decimals, wrong asset, missing
or contradictory evidence, threshold boundaries, a later multiplier, pending
state, refunds, custom reverts and sample-size/reference-valuation edges from real
vectors. `PENDING` and `UNRECONCILED` are proven only by these synthetic edges;
the other three statuses have onchain proof. No realized onchain amounts are
invented in the recorded vectors.

## Quality statistics

Input is one final receipt per intent/transaction (the I/O layer must read latest
snapshots). Group by issuer and actual hop count, with a null hop-count bucket
when route evidence is missing. Pending entries are counted and excluded from
completed attempts and distributions. Unreconciled/failed attempts count in the
fill-rate denominator but never in price distributions.

`n` counts reconciled fills; `fillRate` = fills / completed attempts, or null when
no attempts completed. Signed differences use arithmetic median and nearest-rank
p90. Each distribution reports its own sample count and insufficiency. Overall
and group `insufficient` is true at n < 5, including empty/pending-only inputs.

Reference comparison uses historical USD price per share and an explicitly
supplied historical USD valuation of the spend token, both tied to the intent.
All valuation/share math stays bigint until the output bps ratio. Missing,
ambiguous, wrong-ticker or invalid reference facts give a null statistic with a
reason. The recorder does not record historical USDT/USD, so the real-only report
does not silently assume a $1 peg. Synthetic reference-valuation tests verify
that calculation separately. Gas is excluded from execution price.

## Verification and refreshing evidence

```bash
pnpm --filter @tally/mod-receipts test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

Read-only, authorized recorder (root `.env` or environment must contain
`BSC_RPC_NODEREAL`, as a full endpoint or provider credential):

```bash
python3 spike/record_receipt_vectors.py
```

It writes a new timestamped file exclusively and never prints the endpoint.
It only calls `eth_chainId`, `eth_getTransactionByHash`,
`eth_getTransactionReceipt` and `eth_call`. The endpoint format follows
[NodeReal's documentation](https://docs.nodereal.io/reference/find-api-key-endpoint).
Historical refusal codes/messages are retained with credential redaction.

## Slice B: ingestion, worker and consumers

The browser subscribes with `{ replay: true }` and posts a bounded, strictly shaped
hint to `POST /api/receipts`. It never posts realized amounts, logs or transaction
status. Replay recovers a resumed signed hash with the current wallet user; a
resumed success can also supply a user hint from WO-01's event. Missing original
quote/simulation stays missing. Delivery failures warn, retry twice and never
interrupt trading; unmount cancels outstanding requests and timers.

The endpoint requires same origin and JSON, limits the actual stream to 16 KiB,
limits each IP (30/minute) and hash (10/minute). Pending hints are keyed by
`txHash:intentId`, so unverified claims cannot lock out another intent. Only
promoted chain evidence binds a hash to one intent and refuses another with 409.
Cloudflare supplies the IP header; without it callers share a conservative bucket.
Trust `cf-connecting-ip` only when the origin is reachable exclusively through
Cloudflare; the EC2 must not expose port 3000 publicly.
It rejects foreign destinations, mismatched senders and malformed signed calls.
Only ShareGuard's two buy selectors and a nonzero, non-unlimited USDT approval to
ShareGuard are accepted. Signed assets, spend, recipient and minimum come from
chain calldata. Browser metadata never supplies those facts.

When a reverse proxy gives Next an internal request URL, set `TALLY_APP_ORIGIN`
to the canonical public origin (scheme + host + optional port, no path or trailing
slash). This value is server-controlled; forwarded-host headers are not trusted.
In production, the server environment needs `TALLY_APP_ORIGIN=https://<public domain>` when `FEATURE_RECEIPTS=1`.
The web and worker must share `TALLY_DATA_DIR`. Hints use unprotected
`receipt-hint` rows, expire after 15 minutes and are capped at 1000 hints, including
multiple intents for one hash. Activity and Quality count pending transactions once.

The `receipts` worker (started by `deploy/restart.sh`; see `docs/deployment.md`) verifies hints through `engine.transactions`, checks stock
metadata against the engine registry, and promotes evidence to protected
`receipts` rows keyed by transaction hash. Signed transactions remain protected
pending evidence if subsequent reads fail, even after the hint expires. A mined
receipt remains recorded if registry lookup fails; its missing metadata is
explicit and recoverable. RPC errors never imply a failed transaction. Only a
chain-confirmed revert produces `FAILED`. Approval evidence is shown separately
and excluded from fill statistics. No Binance trading call or broadcast occurs.

Reads use NodeReal then Ankr with the same environment aliases and fixed, numbered,
redacted warnings as the flow reader. Fixture mode lazily reads the newest
`receipt_vectors_*.json`; unknown hashes stay unknown, including M3's pseudo swap
hashes. It never invents realized data for those hashes.

`ReceiptVM`, `ActivityVM` and `QualityVM` expose source, age, stale, empty/error
states and string-serialized quantities. The evidence drawer includes signed
minimum, gas cap/usage, block, guard, conversion observation and log indices.
Missing simulation output uses quote comparison with normal fill-difference copy.
A resumed fill can show chain-proven received shares while reconciliation still
reports the missing original quote. Snapshot fallback content remains visible
when module health has never succeeded.

Browser quotes, route descriptions and simulation validation remain explicitly
unverified. `storedQualityReport` excludes them from verified comparison
statistics and route attribution; `n` counts fills with recorded comparisons,
while completed/pending counts and fill rate retain chain evidence. It exposes
`chainReconciledCount` and `unverifiedComparisonCount` separately. Historical US
reference and spend-token USD observations remain required: no $1 peg is assumed.
At fewer than five verified comparison fills, the view model and plain component
say there is insufficient data. Latest-list consumers cap at 1000 keys and report
truncation; worker polls at most 50 eligible candidates per run.

`get_receipt(txHash)` is a flag-gated, read-only MCP snapshot lookup registered
through WO-05's optional loader. It distinguishes verified evidence, pending
untrusted hints, missing observations and stale snapshots without hot RPC.

**WO-12 integration:** mount `<ReceiptRecorder />` once inside `WalletRoot` only
when the server's `FEATURE_RECEIPTS` flag is on. The production receipt page,
Activity tab and quality page are WO-12's paths. Consume these typed view models;
this work order ships only plain components and flag-gated dev previews.

Offline previews and browser evidence (isolated database, actual F11 vectors):

```bash
pnpm build
pnpm --filter @tally/web exec playwright test --config modules/receipts/playwright.config.ts
```

The config, spec and offline seed live in `apps/web/modules/receipts/`. Screenshots
are generated under ignored `apps/web/test-results/receipts/evidence/`; attach them
to the PR instead of committing binaries or placing test files in route folders.

Both feature flags remain default off. The ingestion endpoint is an unauthenticated
hint writer and still needs the orchestrator's security review before merge.
