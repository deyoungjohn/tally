# Roadmap

What is not built, in no particular order. Each item is independent. The repository's [`docs/MILESTONES.md`](https://github.com/deyoungjohn/tally/blob/main/docs/MILESTONES.md) tracks the larger ones.

## Product

* **Atomic Migrate.** Moving a holding between issuers in one transaction needs a contract that pulls the source tokens, sells through the allow-listed router, buys the target through ShareGuard and reverts everything if either floor is missed. Until then Migrate is two confirmed transactions.
* **Total return by issuer.** Show which issuer actually passes dividends through: Ondo reinvests them in the multiplier, bStock reports them separately. The missing piece is a timestamped history of multiplier readings.
* **Reliable 1-hour, 24-hour and 7-day windows** on every Radar panel. See [Radar and Flow](../modules/radar-and-flow.md).
* **Pies beyond the first version.** Atomic baskets, batch buying, automatic rebalancing and selling a basket.
* **Custom, user-defined baskets.** Create, name, save and share your own.
* **Watchlists.** Follow tokenized stocks you don't hold yet, with their share price, liquidity grade and 24-hour change, and get Guardian alerts on them.
* **Smart recommendations.** Suggestions based on what you hold, not one rotated list.
* **Basket alerts in Guardian.** Tell users when something changes in a basket they bought.
* **Paying with, or selling for, BNB.** USDT is the only trading currency today.
* **A landing page, a replayable on-site tutorial and a fuller How it works.**

## Platform

* **Autopilot's executor.** Shadow mode exists; nothing executes.
* **A hosted MCP endpoint** with a global request cap, and agent payment and identity standards (x402, ERC-8004 and ERC-8183 through BNB Agent Studio).
* **An independent audit of ShareGuard** and a multi-signature owner.
* **A bounded event store for Flow** so each trade is stored once.
