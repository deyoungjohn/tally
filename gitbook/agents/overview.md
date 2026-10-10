# Tally for agents

An AI agent that deals in tokenized stocks needs two things: **information it can trust** and **execution that is checked onchain**. Tally provides both as tools, and never holds a key.

## What an agent gets

| Need | Tool | Guarantee |
|---|---|---|
| A price in the right unit | `get_consolidated_quote` | Shares, not tokens, across issuers, with premium, route and fee. |
| Whether a token is safe to trade | `get_integrity` | An A to F grade with a logged reason for every check. |
| What a wallet holds | `get_shares_of` | Exact integers. An unknown multiplier is reported as unknown, never 1:1. |
| A buy that cannot short the user | `build_guarded_swap` | An **unsigned** transaction through ShareGuard with a share floor. |
| A sale | `build_sell_swap` | An unsigned sale with the router's minimum-receive floor (enabled only when selling is on). |
| What happened | `get_receipt` | Shares received against the floor, from the chain's logs (enabled only when receipts are on). |

The agent's own wallet previews and signs. No tool signs or sends, and Tally never sees a key. See [MCP tools](mcp-tools.md).

## Same engine, same numbers

The MCP server calls `@tally/engine`, the engine behind the website and the bot. An agent and a person see the same quote and the same grade. Data from a recording says so (`fixtures: true`) and must never be sent to a wallet.

## The Wallet Skill

`skills/share-true-trading/SKILL.md` is a skill for Binance's Agentic Wallet. It tells the agent to resolve a ticker, compare issuers in shares, check the grade, build the transaction without signing, show the user the preview and execute through `baw` only after explicit confirmation. It never selects xStocks, never treats an unknown multiplier as 1, and resolves token addresses only through Tally's registry.

## What we tested live

An unattended sale executed through `baw contract-call preview` and `execute` with no tap in the Binance app on 6 October. The approval did not use the Developer Mode quota; the sale counted its USD value. See [Autopilot](../modules/autopilot.md) and `docs/evidence/V-AW-live-sell.md`.

## Hosting

The MCP server runs as a local stdio process beside the agent. An opt-in Streamable HTTP transport exists (loopback only, per-client and global rate limits, concurrency limit, optional shared credential), but **no hosted endpoint is live**. Hosting steps are in the repository's [deployment guide](https://github.com/deyoungjohn/tally/blob/main/docs/deployment.md).

## What it does not do

* No advice. Copy states facts.
* No stocks outside the Ondo, bStock and xStocks tokens, and no direct route between two stock tokens (the aggregator refuses it).
* ShareGuard's share floor covers buys only.
* No autonomous trading. Autopilot is shadow-mode only.

## Possible next steps

Paying per call (x402), an onchain agent identity and task listing (ERC-8004 and ERC-8183 through BNB Agent Studio) and a signing session limited to the router and a daily amount. We read how BNB Agent Studio works (agents on AWS Bedrock AgentCore with session keys); Tally does not use it.
