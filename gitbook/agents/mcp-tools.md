# MCP tools

The server speaks MCP over stdio (and an opt-in HTTP transport). Run it offline against recordings:

```bash
TALLY_FIXTURES=1 pnpm --silent --filter @tally/mcp start
```

One-shot calls, JSON in and JSON out:

```bash
TALLY_FIXTURES=1 pnpm --silent --filter @tally/mcp call get_consolidated_quote <<'JSON'
{"ticker":"NVDA","usd":6}
JSON
```

Fixture mode replays Seoul recordings as of 2026-10-02 05:26 UTC with an in-memory wallet. Every result says `fixtures: true`. Fixture calldata must never be sent to a wallet.

## Information tools

### `get_consolidated_quote`

Input: `ticker` and **exactly one** of `usd` or `shares`. Output: one row per issuer with the multiplier and its source, shares out, price per share, premium to the reference, hop count and route, estimated fee, integrity grade and reasons, and a `best` flag that ranks effective cost per share (fee included).

### `get_integrity`

Input: `ticker`. Output: a grade per token with the full integrity log. A token that cannot be traded is marked not executable with the reason (ghost, paused, multiplier out of bounds, unknown).

### `get_shares_of`

Input: `address` and optional `tickers`. Output: balances as exact integers in shares, with the source per row and zero balances retained. An unreadable multiplier is `shares: null` with its reason.

## Execution tools (unsigned)

### `build_guarded_swap`

Input: `ticker`, `issuer` (`bstock` or `ondo`), `usdtAmount`, `wallet`, `recipient` (must equal the signing wallet) and either a decimal-string `minShares` or `tolerancePct`. Output: one of `needs_funds`, `needs_approval` (an exact-amount approval) or `ready` (calldata, gas limit, floor and simulation). It never pretends an approval exists.

### `build_sell_swap`

An unsigned sale to USDT with the router's minimum-receive amount. Registered only when the server's sell flag is on.

### `get_receipt`

Reads a transaction's outcome: shares received against the floor, from the chain's logs. Registered only when receipts are on.

## Errors

Tool errors use the same plain messages as the web app: region block, below the minimum, paused, ghost, price moved. The engine maps typed errors once, so every surface explains a failure the same way.

## Setup

The repository's [`packages/mcp/README.md`](https://github.com/deyoungjohn/tally/blob/main/packages/mcp/README.md) has client setup for Claude Code, Cursor and BNB Agent Studio, the rate-limit and credential settings, and a full $6 live test through Binance's Agentic Wallet.
