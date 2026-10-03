# Receipts — WO-02 Slice A

Pure TypeScript: `reconcile(receipt)`, `qualityReport(receipts, referencePrices)`,
`decodeGuarded(log)`, `decodeTransfer(log)` and `decodeRevert(data)`. No I/O,
new dependencies, buy-flow changes or contract changes.

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
the other three statuses have on-chain proof. No realized on-chain amounts are
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

## Deferred to Slice B

WO-01 `onStage` subscription; SnapshotStore persistence; NodeReal/Ankr worker
reconciliation with warning and health reporting; ReceiptVM/ActivityVM/QualityVM,
plain components and their stale/error/flag tests; MCP `get_receipt`. WO-00 is
merged; WO-01 is not yet on main. This slice exports pure logic and adds no live
UI/worker integration. Default-off flags and the existing trade flow are unchanged.
