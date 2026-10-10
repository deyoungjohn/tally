# The story

Tally was built in ten days for **BNB Hack: Tokenized Stocks Edition** (submissions lock 11 October 2026, 12:00 UTC). This page is the short version of how it went from an idea to a deployed product. [Challenges](challenges.md) has the detail.

## 30 September: what the market says

Before writing code we measured the market and analysed what the 87 projects that won 15 earlier hackathons built. Two signals stuck: evidence you can verify (receipts, proofs, audit trails) shows up in 57% of winners, and precise financial primitives beat generic "AI trader" projects. The market data told us the rest:

* There were 517 tickers across 675 tokens on BNB Chain from three issuers, and **the same stock could look 900% apart** because of share multipliers.
* The multiplier even differed by source for the same token.
* So Tally's bet: be correct about *what you get*, back it with an onchain guarantee, then be cheapest.

We shortlisted two ideas and chose Tally because every risk we could test on it had a verified answer: region, contracts holding the tokens, real routes, both issuers, and live money.

## 1 October: the facts that retired the risks

* **Region:** the Binance Web3 API refuses callers from some countries for the whole API (`40304`, sent as HTTP 200). The server has to live in an allowed country. AWS Seoul works.
* **Routes:** a quote returns one route from one vendor. The aggregator offers no comparison, so Tally has to quote each issuer's token itself.
* **A prototype guard** passed fork tests with real calldata. Then the first **live buy** reverted out of gas because the API's gas number is a placeholder. The fix (estimate, add 25%, simulate at that exact limit) became a rule.

## 2 October: three milestones in a day

1. **The engine:** pure share maths, the issuer registry, integrity grades, a signed API client with fixtures, chain access with failover, and a CLI.
2. **ShareGuard v1:** designed against the prototype's hole, tested on a mainnet fork, **deployed and verified**, with two live guarded buys: one bStock, one Ondo through the signed feed.
3. **The web trade flow:** quote, approve, swap and receipt in shares, with Privy wallets and a region gate.

## 3 to 6 October: modules, and a team

The single milestone plan became a module plan: Receipts, Portfolio and Statement, Radar and Flow, Guardian with a Telegram bot, Migrate, Pies and Autopilot (shadow mode). Work was split into work orders with explicit file ownership and handed to a team of AI coding agents under one human chief engineer. See [Building with a team of AI agents](multi-agent-workflow.md).

On 6 October an unattended sale ran through Binance's Agentic Wallet with no tap.

## 7 to 10 October: widening and hardening

* **ShareGuard grew** from 10 tokens to 30 through gated, evidence-checked owner batches, each confirmed onchain.
* **Migrate** shipped as a guided two-step flow after we proved the API cannot do a stock-to-stock swap.
* **Real use found real bugs:** a market-maker order that expired before it mined, a database that grew to 8 GB, a Radar page that froze the server, an RPC provider whose quota ran out, a wallet that stayed "connected" after sign-out. Each is written up in [Challenges](challenges.md), with the fix.
* **The domain, a Cloudflare tunnel and this documentation** went up.

## What we would do next

See the [Roadmap](../reference/roadmap.md): atomic Migrate, reliable 1-hour, 24-hour and 7-day windows, user-defined baskets, smarter suggestions, a landing page and a replayable tutorial.
