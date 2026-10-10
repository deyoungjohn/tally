# Pies

A **pie** is a basket: a fixed list of stocks, bought together from one budget. Pies is the first version of basket buying, built to be small and exact.

{% hint style="info" %}
Binance returns no baskets. Its sector filters (`tabId`) are ignored by the API, so every basket is Tally's own fixed list in the repository. User-defined baskets are on the [roadmap](../reference/roadmap.md).
{% endhint %}

## What it does today

* **Baskets:** Tally's own lists, starting with **Big Tech** (NVDA, AAPL, GOOGL, MSFT and META at 20% each, as bStock tokens, all enabled on ShareGuard).
* **Budget and weights:** you enter a total budget in USDT and a weight for each stock. Weights must total exactly 100%.
* **The plan:** `basketBuyPlan` (pure, `bigint`, USDT with cents rounded down) turns that into legs. A leg under the 6 USDT minimum is **deferred and listed with its reason**, never dropped or merged silently. The unspent remainder is shown.
* **Execution:** the app buys the stocks **one after another** through ShareGuard, one wallet confirmation sequence per stock, without you selecting and buying each manually.

## Execution rules

1. **One leg at a time.** A fresh plan is fetched right before each signature, because quotes expire in seconds.
2. **The plan must match the leg:** ticker, issuer, symbol and exact amount. An approval must be for exactly the leg's amount.
3. **Refusals:** missing funds, an expired quote, or anything that is not a valid zero-value transaction on BNB Chain.
4. **Stop at the first failure.** There is no automatic retry. The page shows exactly what happened: legs done with their receipts, the failed leg with a plain reason, and legs not started. A "continue with the remaining legs" action re-plans from the failed leg.
5. **Never send twice.** If a signature is interrupted before its hash is saved, nothing is resent; the page asks you to check wallet activity.
6. **Resumable.** The run is saved against your wallet for 24 hours. After a reload it checks the saved transaction hashes on-chain and carries on.
7. **Wallet change stops it.** Changing the connected wallet cancels the run.

## Not built

Atomic one-transaction baskets, batch buying, automatic rebalancing and selling a basket. A basket purchase is several independent guarded buys, each protected by its own share floor; there is no all-or-nothing guarantee across them.
