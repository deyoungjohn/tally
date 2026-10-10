# Challenges and how we solved them

Each entry says what happened, why, what we changed, and where the evidence is. The pattern across all of them: **a number that looks right is not the same as a number that is right**, and the fix is almost always to verify against the chain or to say plainly that we cannot.

## The unit trap

**What:** the same stock looked 900% apart across issuers.
**Why:** Ondo's NFLX token is ten shares and bStock's is one; the multiplier also moves with dividends, and three sources can give three values for one token.
**Fix:** convert every amount to shares with `bigint` maths, compare the sources and grade the disagreement, and never assume 1:1. See [The unit trap](../concepts/the-unit-trap.md).

## The API refuses callers from some countries

**What:** a call from a US VPN returned `40304 "Service not available due to compliance restriction"` for the whole API, even `supported/chain`, as **HTTP 200**. Netherlands and Romania were blocked too; Japan was not.
**Why:** the check is on the IP that calls the API, not per token or wallet.
**Fix:** every Binance call comes from the AWS Seoul server, and Tally blocks the hackathon's restricted regions itself at the edge (fail closed). The client checks the JSON `code`, never the status. Behind a Cloudflare tunnel the first gate used a rewrite and failed with `EPROTO`; it now answers directly, with a regression test.

## The API says 450,000 gas; the route needs 775,639

**What:** the first live buy reverted out of gas. The aggregator's gas number was 450,000 on every quote.
**Why:** it is a placeholder. Real routes used 437,968 to 1,024,000. The fork tests passed because Foundry does not cap gas, and the dry-run `eth_call` had no cap either.
**Fix:** estimate the gas, add 25%, simulate **at that exact limit** and send that limit. A test (F) fails when a route does not fit our limit. Live swaps confirmed it: one used 775,639 gas and would have reverted at 450,000. See [Testing](../smart-contracts/testing.md).

## A prototype guard with an arbitrary-call hole

**What:** the early guard called any caller-supplied address. A fork test showed an attacker could pull a dust amount of the stock as "input", point the call at USDT and drain a victim's approved balance.
**Fix:** ShareGuard v1 allow-lists routers and approve targets, rejects `tokenIn == stock`, and never lets a router be a stock token. The prototype is never deployed.

## Ondo has no onchain multiplier

**What:** a contract that must check shares cannot read Ondo's multiplier from the token.
**Fix:** a stored, owner-seeded value kept current by bounded, monotonic, EIP-712-signed updates inside the user's own swap, with corporate actions for splits. See [Multiplier sources](../smart-contracts/multiplier-sources.md). While wiring it, using the wrong source number for Ondo made every Ondo buy fail with "share count can't be read right now" until the source was corrected.

## There is no direct stock-to-stock route

**What:** moving NVDAB to NVDAon in one transaction was not possible. The API answers `40368` on every pair.
**Fix:** Migrate became a guided two-step flow (sell to USDT, then a guarded buy) with a combined receipt. An atomic version needs a contract of its own and is on the [roadmap](../reference/roadmap.md).

## The list is not the registry, and "reference price" is per token

**What:** the authenticated RWA list returned 488 of 675 BNB Chain tokens and no xStocks, and ignored every paging parameter. Its `referencePrice` for Ondo NFLX was ten times the quote API's price.
**Fix:** the registry comes from the public lists; the authenticated list supplies status and reference. The reference is divided by the token-to-share ratio, after which two issuers agree to 0.01%.

## A quote that expires before it mines

**What:** three sales of TSMB reverted onchain with `RFQ_OrderExpired`. The server's own simulation had passed seconds earlier.
**Why:** the best route was a market-maker order that lives only a few seconds. Plan, signature and mining together outlasted it. One replay one block before showed the revert; the others replayed fine, so the order expired in the very block that mined them. Some wallets also refuse to preview such orders.
**Fix:** prefer a pool route when its output is within 0.5% of the market-maker route, flag a market-maker route and ask the user to confirm promptly, explain a reverted sale in plain words, and offer Try again. The same chooser now drives buys.

## Rate limits and request sizes

**What:** 30 back-to-back calls got `42900` after about five. Later, batching 100 token addresses in one price request got HTTP 414 (URI too long).
**Fix:** a token-bucket client (burst 3, then 4 a second, retries with backoff) and batches of 20.

## Schemas from the docs failed on real data

**What:** `assetType` was `null` on some rows and `executionMode` was at the top level, not where the docs said. The first version swallowed the failure and fell back to stale public data.
**Fix:** schemas from recordings, and a rule that every fallback warns and every missing fact carries its reason.

## Mocks that match the docs, not the SDK

**What:** twice, tests passed against a mock written from documentation while the real SDK shape differed (Privy's token claims are snake_case; a registry field was `underlyingTicker`, not `ticker`).
**Fix:** reviews now check mock shapes against real ones, and tests use recorded or real shapes.

## Running it for real

These are the incidents from the first days of live use.

### The database that grew to 8.3 GB in eight hours

Each token's Flow snapshot held the whole merged trade tape, about 1 to 1.6 MB, rewritten every cycle and kept for seven days. The disk filled and everything stopped. A one-shot delete then filled the remaining disk because SQLite writes every change to its log first. The fix: 30-minute retention for the large kinds, deletes in small chunks, and a store that always keeps the latest row per key.

### One lock killed four workers

SQLite allows one writer. A large prune held the write lock past the timeout, a failed health write escaped the job loop, and four workers exited. Now health writes are retried and never end a worker, the wait is 30 seconds, and prune deletes 200 rows at a time.

### A provider that said "daily request limit reached"

The primary RPC's quota ran out. The library's failover treated that error code (`-32003`) as a rejected transaction and stopped instead of trying the next endpoint, so every chain read failed with three fallbacks configured. A limit error is now treated as a failed endpoint, with a test that fails on the old code. The health endpoint also reports why a read failed, with every URL removed.

### A page that got slower as the list got longer

The Portfolio inspected every supported ticker, one at a time, and discarded all but the ones the wallet held. Going from 6 to 21 tickers made it take 15 to 20 seconds. It now inspects only held tickers, caches the shared part and bounds concurrency.

### A Radar page that froze the whole server

The Radar loader decoded every token's full trade tape on each request, about 300 to 450 MB of JSON parsing on one thread. Measured on the server, the Radar took 29.5 seconds and a health check at the same moment took 28.5, because the thread was blocked. It now reads two small snapshots per token and caches the result. A synthetic 275-token store dropped from 62 seconds to 0.37 seconds.

### A page that never finished loading

A timed refresh aborted the request still in flight. An endpoint slower than its refresh interval therefore never finished. A refresh now waits for the running request.

### A wallet that stayed "connected"

After sign-out, a leftover external wallet was still listed as connected, and Tally showed its address and balances to the next user who signed in. An external wallet is now used only if the user connected it on purpose in the current session, sign-out disconnects it, and saved in-progress work is tied to its wallet.

### The wrong name for a credential

The server expected `BINANCE_W3_*` and the file said `BINANCE_WEB3_*`, so live calls failed quietly for hours. The restart script now refuses to start without the names the code reads and says which look like misspellings.

### Labelling fixtures

A browser check that guessed "fixture data" from a transaction hash starting with `0xf1` would have labelled about one real hash in 256. Only the server says whether data is a recording.

## What we kept doing

Record the real response. Replay it in tests. Write the evidence next to the claim. Prefer a plain "unknown" to a confident wrong number.
