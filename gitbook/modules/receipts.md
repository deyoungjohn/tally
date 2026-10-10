# Receipts

A receipt answers "what did I actually get?" from the chain, not from the browser or from Tally.

## How a receipt is made

1. When you send a transaction, the browser posts a short-lived **hint** (the transaction hash and the quote it came from) to `/api/receipts`. The route accepts it only when the request's origin equals the app's origin.
2. The `receipts` worker follows the transaction until it is mined, decodes the logs (the `Guarded` event for buys; USDT and token `Transfer` logs for sells) and records a verified result next to the quote.
3. The receipt page reads that result and shows shares received against the minimum, the route, gas used and a BscScan link.

## What is verified, and what is quoted

Every figure is labelled **Verified** (from the chain receipt) or **As quoted** (from the plan you signed). A leg that has not been verified shows "Pending" with no number. Nothing is filled in from the quote.

## Public and shareable

`/receipt/[txHash]` needs no sign-in and reads public chain data. For a Migrate, `/receipt/migrate/[sellHash]/[buyHash]` combines both legs, and the page checks that the two transactions really are one Migrate: same wallet, sale first, same ticker, different issuers, and the sale paid at least what the buy spent. Anything else says "These two transactions are not a Migrate".

## Quality: live fills

The same records feed a "Live fills" view: how real fills compared with their quotes by issuer and by route length, from chain-verified fills only. It counts pending attempts and says plainly when the data is thin.

## Sale proceeds read straight from the chain

Migrate needs to know what a sale paid before it can buy. `GET /api/trade/sale-proceeds?hash=` reads the transaction receipt directly and answers `pending`, `failed`, `confirmed` (USDT received, tokens spent) or `unrecognised`. It does not depend on the worker or on a hint, so a sale from hours ago still resolves after a reload.

## Known limits

* A forged hint could attach a wrong quote to someone else's pending transaction first. The recorded amounts still come from the chain, so the numbers stay right; the labelled quote could be wrong. We accepted this risk and noted the fix for later.
* If the chain RPC is out of quota, verification stalls and the page says "No receipt yet". Providers fail over now, and the health endpoint reports why a chain read failed.
