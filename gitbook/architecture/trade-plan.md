# The trade plan

`engine.trade.prepare({ ticker, issuer, usd, tolerancePct, user })` turns "buy $X of this token" into something a wallet can sign. It re-quotes on every call and answers one of three states.

| Status | Meaning | What the app does |
|---|---|---|
| `needs_funds` | Not enough USDT or BNB, with the shortfall | Shows the shortfall and the top-up options |
| `needs_approval` | An exact-amount `approve(guard, amountIn)` is needed first | Asks the wallet to sign it, waits for it to mine, then asks again |
| `ready` | Guard calldata, gas limit and simulation result | Shows the review and asks the wallet to sign |

## Why two phases

The gas estimate and the simulation both need the allowance to exist. Without it, the guarded call reverts on `transferFrom` and the error says nothing useful. So the plan is asked for again after the approval mines, and again when its 15-second freshness window passes.

## What "ready" contains

* **The calldata** for `swapForShares` (or `swapForSharesWithFeed` for Ondo), with the router data the aggregator built for ShareGuard as the user.
* **The floor:** `minShares`, the quoted shares minus the user's tolerance.
* **The gas limit:** `eth_estimateGas` from the user × 1.25, simulated with `eth_call` at that exact limit. Binance's own simulate endpoint is also called; if it fails, that is a warning, not a gate.
* **Warnings:** for example "Market-maker quotes expire in a few seconds. Confirm promptly."

## The Ondo feed signer

Ondo has no on-chain multiplier, so the contract keeps a stored value that the owner seeded and a bounded, signed feed keeps current. There is no separate sign endpoint: `prepare` signs a bounded `FeedUpdate` itself, and only when the stored value is stale or differs from the engine's accepted multiplier by more than 1 ppm. `FEED_SIGNER_PK` is read only on the server. See [Multiplier sources](../smart-contracts/multiplier-sources.md).

## Route choice

The plan chooses a route with the shared route chooser (pool route within 0.5% of the best market-maker route, otherwise the market-maker route flagged). The sell plan uses the same chooser. See [Share-true quotes](../concepts/share-true-quotes.md).

## Errors become plain words

Errors are typed (`price_moved`, `token_paused`, `feed_stale`, `rfq_required`, `not_buyable`, `below_minimum`, and so on) and mapped to short sentences by one function, so the web app, the bot and the agent tools explain failures the same way. A revert reason from the chain is decoded rather than shown raw.

## After the swap

`engine.trade.receipt(hash, ticker)` decodes the `Guarded` event: the buyer, the stock, tokens received, shares credited, the multiplier used and the router. The receipt page shows shares received against the floor, read from the chain. See [Receipts](../modules/receipts.md).
