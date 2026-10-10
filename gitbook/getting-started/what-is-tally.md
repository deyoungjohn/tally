# What Tally is

Tally is a layer between you and the tokenized US stocks on BNB Chain. It does three things that a normal token swap interface does not.

1. **It counts in shares.** Every quote, balance and guarantee is expressed in shares of the stock. A token's price per share is the token price divided by its share multiplier, read from the chain where the issuer exposes it.
2. **It compares issuers.** For one stock it quotes each issuer's token live and ranks them by what you would actually receive, including the network fee.
3. **It guarantees the minimum in shares.** Buys go through a contract, [ShareGuard](../smart-contracts/shareguard-overview.md), that reverts the whole transaction if the shares you receive are below the minimum shown on your review screen.

## What it is not

* **Not custody.** Tally never holds your funds or keys. You sign every transaction in your own wallet (a Privy embedded wallet from an email or Google sign-in, or an external wallet such as OKX or Binance Web3 Wallet).
* **Not the underlying stock.** The tokens track a US stock's price. You do not own the share and have no shareholder rights.
* **Not advice.** Copy states facts. Suggestions on the Portfolio page are the same short list for everyone, rotated per wallet, and are labelled as such.
* **Not a venue.** Tally does not match orders. Trades execute through the Binance Web3 aggregator's router on BNB Smart Chain.

## The surfaces

| Surface | What it does |
|---|---|
| Web app (`app.tallyprotocol.xyz`) | Home, Trade, Portfolio, Radar, Guardian, Pies. Buy, sell, migrate between issuers, read receipts. |
| Telegram bot | Read-only commands (`/quote`, `/shares`, `/shield`) and Guardian alerts after you link your wallet. |
| MCP server | The same engine as tools an AI agent can call, with unsigned transactions the agent's own wallet signs. See [Tally for agents](../agents/overview.md). |

All three use one engine, so the numbers are identical everywhere. See [Architecture](../architecture/overview.md).

## Scope today

* BNB Smart Chain mainnet only, spot only, buys through ShareGuard, sells through the router with the router's own minimum-receive protection.
* Ondo and bStock tokens are tradable. xStocks tokens appear as data and as a trap example: on BNB Chain they have almost no liquidity.
* The minimum buy is 6 USDT and the minimum sale is 5 USDT.
* A short list of regions is blocked at the edge. See [Security model](../architecture/security-model.md).
