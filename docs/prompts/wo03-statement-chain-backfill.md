# WO-03: fill unknown statement and receipt facts from the chain

Same worktree and branch as WO-03 (fast-forward to `main` first); no new branch; commit, push, keep an open PR with the latest push. Owner decision 2026-10-10: a transaction the feed does not know must not be shown or stored as "unknown" while the chain can tell us. Look it up and fill it in. **Ships after the demo and the Developer Experience Report (not before the 10 Oct freeze).** See `docs/MILESTONES.md` §6.

**Standing rule (owner, 2026-10-10): before any field anywhere in Tally is recorded or shown as unknown or "-", the Etherscan V2 explorer API is asked as the last fallback.** Order: our usual source, then our RPC, then the explorer, and only then "-".

## Sources: our own RPC first, the explorer API as the fallback
- **Primary source is the chain through our existing RPC clients** (`@tally/chain`, archive RPC for old blocks). This is what BscScan itself reads, needs no new key, and is not a third party. BscScan is an indexer: it can lag, rate-limit and omits what only we compute (the shares multiplier at that block, the issuer, the price).
- **The Etherscan V2 API (`chainid=56`, covers BSC; BscScan's own API is served through it) is the fallback source.** The owner has a key: 5 calls per second, 100,000 per day. It is read from `ETHERSCAN_API_KEY` in `/etc/tally/tally.env`; never read, print or ask for it, and no key means the step is skipped with a logged reason, never a failure. Document the variable in `docs/deployment.md` only. Use it for: discovering transaction hashes for a wallet (token transfers), and for any field our RPC could not give. Budget: a shared token bucket at 4 calls per second, a persisted daily counter that stops at 90,000, a cache so one hash is asked once, and a logged reason whenever it is skipped.
- **Trust:** the explorer reads the same chain, so what it reports about a mined transaction is not a different truth, but it is an indexer that can lag. A value that came from the explorer is stored with provenance "explorer" and, where our RPC can verify it cheaply (an amount against the receipt's logs), it is checked and a mismatch is dropped and logged.

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
