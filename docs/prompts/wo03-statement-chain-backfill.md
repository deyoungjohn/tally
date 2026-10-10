# WO-03: fill unknown statement and receipt facts from the chain

Same worktree and branch as WO-03 (fast-forward to `main` first); no new branch; commit, push, keep an open PR with the latest push. Owner decision 2026-10-10: a transaction the feed does not know must not be shown or stored as "unknown" while the chain can tell us. Look it up and fill it in.

## Source: our own RPC first, BscScan second
- **Primary source is the chain through our existing RPC clients** (`@tally/chain`, archive RPC for old blocks). This is what BscScan itself reads, needs no new key, and is not a third party. BscScan is an indexer: it can lag, rate-limit and omits what only we compute (the shares multiplier at that block, the issuer, the price).
- **BscScan / Etherscan V2 API is an optional second source**, used only to discover transaction hashes for a wallet (token transfers list) when the key `BSCSCAN_API_KEY` is set in `/etc/tally/tally.env`. Never read, print or ask for the key; no key means the step is skipped with a logged reason, never a failure. Document the variable in `docs/deployment.md` only.
- **A transaction must never be recorded from an explorer's word alone.** Every amount, token and block comes from the receipt and its logs on our RPC, as the receipts module already does. The explorer may only add a hash to look at.

## What to fill
For each hash in the statement or a receipt with a missing field: fetch the receipt and logs, decode the ERC-20 `Transfer` events to and from the wallet, and resolve the token through the registry. Then fill, each with its provenance ("from the chain"):
- token, issuer and ticker for any token in the registry;
- token amount and the **shares at that block** (call `multiplier()` / `uiMultiplier()` at the transaction's block on the archive RPC; Ondo uses the guard's recorded multiplier when there is one);
- the USDT leg of the same transaction (dollar value of a buy or sale), gas used, block and timestamp;
- cost and realized figures only where the legs are all found; otherwise leave the field out.
A token that is not a tokenized stock (BNB, USDT moving as part of a swap) is not a statement line, as today.

## What still shows as unknown
Only what the chain cannot give: an unrecognised token (not in the registry) or a missing multiplier at that block. Show "-" for it (or hide the row field), never the word "unknown". Never guess a multiplier; never assume 1:1.

## Where
`packages/mod-statement` (worker job `apps/worker/src/jobs/statement.ts`, bounded: at most N hashes per run, cached forever once filled because a mined transaction never changes) and `packages/mod-receipts` for receipts. Respect the SQLite lock rules (short writes, no long transactions; the store is already 3.9 GB, so write one small snapshot per filled hash and do not re-read filled ones). Keep RPC calls bounded and use the existing failover.

## Tests
Fixture-driven: a recorded receipt with logs (use `contracts/captures/` or add a recording; never edit `spike/results/` or `packages/binance/fixtures/raw/`). Cases: a sale and a buy both filled; a token not in the registry stays "-"; the explorer key absent skips discovery; an explorer hash whose receipt does not match is dropped; filled hashes are not fetched twice.

## Report
`pnpm typecheck`, `lint`, `format:check`, `test`, `FULL=1 bash scripts/review-pack.sh <branch>` with the real output.
