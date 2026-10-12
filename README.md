# Tally

**The everything app for tokenized stocks on BNB Smart Chain.** Tally compares, buys, sells, migrates, tracks and watches tokenized stocks across the three issuers that offer them on BNB Chain (Ondo, bStocks and xStocks), and counts everything in share units, because one token is not always one share. Tokenized stocks track a US stock's price; they are not the underlying shares.

Built for **BNB Hack: Tokenized Stocks Edition**.

- App: <https://app.tallyprotocol.xyz>
- Home: <https://tallyprotocol.xyz>
- Developer docs: <https://docs.tallyprotocol.xyz> (source in [`gitbook/`](gitbook))

## What you can do

| | |
|---|---|
| **Trade** | One stock, every issuer, ranked by the shares you actually get (not by token price), with the network fee included and the best one marked. A buy settles through the guarantee below. Selling to USDT works the same way. |
| **Migrate** | Move a holding from one issuer to another without leaving the stock: Tally sells the holding for USDT, then buys the same stock from the other issuer. Two transactions you confirm one by one, with a receipt that compares the shares you gave up with the shares you received. |
| **Portfolio** | Holdings from every issuer counted as one, in shares and dollars, with an Activity tab (everything your wallet did with tokenized stocks) and a Statement tab you can export as a PDF or a CSV. |
| **Baskets** | Pick a basket (Big Tech is open; Mag 7, AI Chips and ETFs are listed), set a budget and a weight per stock, and Tally buys each stock through the guarantee, one after another. |
| **Radar and Flow** | Every tokenized stock graded A to F for liquidity and data quality, with the reason for every check, and unit traps flagged. Flow shows net shares in and out of a token, its largest trades and how concentrated its holders are. |
| **Guardian** | Alerts about the tokens you hold: a trading pause, a change in shares per token, a drop in liquidity grade. They appear in the app (the bell) and on Telegram, and you choose which rules are on. |
| **Receipts and Live fills** | Every completed buy, sale and Migrate has a receipt checked against the chain. Live fills compares what was quoted with what was delivered. |
| **Agents** | An MCP server and a Wallet Skill give AI agents the same share-true quotes, grades and unsigned transactions (see below). |

## The guarantee

A raw price comparison misleads: Ondo's NFLXon is ten shares per token while bStock's NFLXB is one, and issuers change the share multiplier over time (dividends, splits). Tally multiplies every token by its current multiplier, grades the data it came from, and refuses a token with no real market.

Buys go through **ShareGuard**, a contract on BNB Smart Chain that routes only through an allow-listed router, checks the issuer's pause state and the multiplier, and **reverts the whole transaction if you would receive fewer shares than the minimum you saw**. If it reverts, nothing is spent except the network fee of the failed attempt. The deployed address, the proof (fork tests against real calldata, two live guarded buys) and the limits are on [docs.tallyprotocol.xyz](https://docs.tallyprotocol.xyz).

Tally is non-custodial. You sign in your own wallet (an email or Google sign-in creates one through Privy, or you connect your own); Tally never holds your keys or funds.

## How it is built

A pnpm monorepo on Node 22.

| Path | What it is |
|---|---|
| `apps/web` | The Next.js app (standalone build): pages, the trade, sell, Migrate and basket flows, and the API routes. |
| `apps/worker` | Background jobs that write snapshots to a shared SQLite store (prices, registry, flow, Radar grades, statements, receipts, Guardian). The web app reads those snapshots. |
| `apps/bot` | The Telegram bot for Guardian. |
| `packages/core` | Pure share maths (bigint, never floats), multiplier resolution, integrity grades, gas model, consolidated quotes. |
| `packages/binance`, `packages/chain`, `packages/engine` | The signed Binance Web3 client, the BSC clients with failover, and the engine that wires them (the CLI and the web call the engine, never the pieces). |
| `packages/mod-*`, `packages/modkit` | The feature modules (receipts, statement, flow, guardian, pies/baskets, autopilot) and the shared snapshot store. Each sits behind a feature flag. |
| `packages/mcp`, `skills/` | The agent layer. |
| `contracts/` | ShareGuard v1 (Foundry), its tests and recorded captures. |

Rules the code follows: shares are always bigint and never assumed 1:1; a fact that is missing carries its reason; every data-source fallback logs a warning; fixture data is never labelled live.

## Develop

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test
cd apps/web && TALLY_ALLOW_MISSING_GEO=1 pnpm dev    # the region gate fails closed without Cloudflare's header
pnpm build && pnpm e2e                               # Playwright at 375/768/1280 (needs the standalone build)
pnpm tally quote NVDA 25 --fixtures                  # the CLI, offline on recorded data
```

Node 22, pnpm 10. Copy `apps/web/.env.example` to `apps/web/.env.local`. Clone with `--recurse-submodules` for the contracts. The authenticated Binance Web3 API refuses callers in the US, so live quotes and buys run on the Seoul EC2; elsewhere the app runs on recorded fixtures (`TALLY_FIXTURES=1`). Deployment: [`docs/deployment.md`](docs/deployment.md).

## Documents

| Document | What it is |
|---|---|
| [`TALLY_BLUEPRINT.md`](TALLY_BLUEPRINT.md) | The build plan: verified facts, decisions, architecture, the ShareGuard spec, milestones and exit checks |
| [`DESIGN.md`](DESIGN.md) | The UI system: tokens, motion, components, responsive rules |
| [`IDEAS.md`](IDEAS.md) | The ideation and validation record, including the findings behind every design decision |
| [`MODULES.md`](MODULES.md) | The module plan |
| [`docs/MILESTONES.md`](docs/MILESTONES.md) | Work planned after the hackathon |
| [`docs/deployment.md`](docs/deployment.md) | Every deployment and operations instruction |
| [`docs/for-agents.md`](docs/for-agents.md) | The agent layer: tools, limits, what is and is not live |
| [`research/`](research), [`spike/`](spike) | Market snapshots, winner analysis, the ShareGuard spike and live-buy results. **Spike code is not for deployment.** |

## Tally for agents

Tally is also a small tool service for AI agents that deal in tokenized stocks on BNB Chain: **information** (share-true quotes, an A to F integrity grade with a reason for every check, holdings in shares) and **execution** (unsigned buys through ShareGuard, which reverts if the buyer would receive fewer shares than the floor; unsigned sells to USDT). The agent's own wallet signs; Tally holds no keys and sends nothing. The tools are an MCP server (`packages/mcp`) plus a Wallet Skill (`skills/share-true-trading/`). Today it runs as a local process; a hosted endpoint is not live. Details and limits: [`docs/for-agents.md`](docs/for-agents.md).

## Roadmap

What is not built, in no particular order. The larger items, with their done-when checks, are in [`docs/MILESTONES.md`](docs/MILESTONES.md).

- **Watchlists.** Follow tokenized stocks you do not hold yet, with their share price, liquidity grade and 24-hour change, and get Guardian alerts on them.
- **An explorer fallback before any value is left blank.** Before a field is recorded or shown as unknown, ask the Etherscan V2 API (after our own source and our own RPC), so receipts and statements show real values wherever the chain has them.
- **Atomic Migrate.** Moving a holding between issuers in one transaction needs a contract, because the Binance aggregator refuses a direct stock-to-stock route (error `40368`). The design: a contract pulls the source tokens, sells through the allow-listed router, buys the target through ShareGuard (which enforces the destination floor, pause checks and the multiplier feed) and reverts everything if either floor is missed. Until then Migrate is two confirmed transactions.
- **Total return by issuer.** Ondo reinvests dividends in the multiplier while bStock and xStocks report them separately. The missing piece is a timestamped history of multiplier readings.
- **Reliable 1-hour, 24-hour and 7-day windows** on every Radar panel.
- **Baskets beyond the first version.** Atomic one-transaction baskets, automatic rebalancing, selling a basket, and opening Mag 7, AI Chips and ETFs.
- **Custom baskets.** Create, name, save and share your own.
- **Smart recommendations.** Suggestions based on what you hold, not one rotated list.
- **Basket alerts in Guardian.**
- **Paying with, or selling for, BNB.** USDT is the only trading currency today; BNB only pays network fees.
- **A replayable on-site tutorial and the full How it works write-up.**

Not investment advice. Not available in restricted regions.
