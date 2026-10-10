# Selling and Migrate

## Selling

A sale converts a stock token to USDT through the same router, signed in your wallet.

* **Protection:** the router's own minimum-receive amount. ShareGuard's share floor exists for buys only, so a sale does not carry the share guarantee. The sheet states the minimum USDT.
* **Minimum sale:** 5 USDT.
* **Exact approvals:** the approval is for exactly the amount being sold.
* **Fresh plan on confirm:** the sale you sign is always built from a quote fetched when you press Confirm, never from the review screen.
* **Route choice:** a pool route is preferred over a market-maker route when its output is within 0.5%, because market-maker orders expire within seconds and a wallet that previews them can refuse them. A sale of TSMB reverted three times on chain with `RFQ_OrderExpired` before this change.
* **A reverted sale** says it did not go through, that nothing was sold, that only the network fee was spent, and offers Try again.

## Migrate

Migrate moves a holding to the other issuer of the same stock, for example NVDAB to NVDAon, in **two separate transactions** you confirm one at a time:

1. **Sell** the token for USDT.
2. **Buy** the same stock from the other issuer through ShareGuard, with the sale's proceeds rounded down to the cent.

### Why it is not one transaction

The aggregator has no direct stock-to-stock route: it answers `40368` ("Ondo asset on chain 56 can only pair with allowed stablecoin(s)") on every bStock and Ondo pair we tried. An atomic Migrate needs a contract of its own and is on the [roadmap](../reference/roadmap.md).

### What it guarantees

* The buy leg carries ShareGuard's share floor; the sale leg carries the router's minimum.
* The two legs are not atomic, so the price can move between them. The sheet says so and shows a combined receipt in tokens, shares and dollars.

### Eligibility

* Source is Ondo or bStock; xStocks has no market to exit.
* The destination issuer is enabled on ShareGuard for that ticker.
* The sale's guaranteed minimum is at least 6 USDT, so the buy can follow.
* The Ondo side is open. Ondo asks for a signed order outside its sessions, so a Migrate in either direction is refused up front, before anything is sold.

### Resuming

The sale and its details are saved against your wallet in the browser. If you reload, close the tab or the server restarts, the sheet resumes. It reads what the sale paid **from the chain**, so it works hours later and does not depend on a worker. If the sale paid under 6 USDT (slippage between the estimate and the fill), the USDT is in your wallet, no buy is offered, and the sheet says so. A saved Migrate expires after 24 hours and belongs to one wallet.

### The receipt

A finished Migrate shows what you gave up and what you received, in tokens, shares and dollars, the guaranteed minimums next to what was delivered, the route and gas of each leg, and a shareable link. The link works from the chain alone and says "These two transactions are not a Migrate" for any pair that is not.
