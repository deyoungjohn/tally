# Tally for agents

Tally gives an AI agent two things it needs to deal in tokenized US stocks on BNB Chain: **information it can trust** and **execution that is checked onchain**. It is a narrow service, not a data catalogue: it covers the Ondo, bStock and xStocks tokens that exist on BNB Chain, and it says plainly when it cannot answer.

## Information

| Tool | What the agent gets |
|---|---|
| `get_consolidated_quote` | A quote for a ticker and amount across the issuers, in **real shares** (not tokens), with the issuer's multiplier, the premium to the reference price, the route and the fee. |
| `get_integrity` | An A–F grade per token with a logged reason for every check (liquidity, price against the reference, multiplier bounds, pause state). A token that cannot be traded is marked not executable with the reason. |
| `get_shares_of` | A wallet's holdings in shares, as exact integers. An unknown multiplier is reported as unknown with the reason, never assumed to be 1:1. |

Quotes and grades come from the same engine as the web app, so an agent and a person see the same numbers. Data that is a recording is labelled as a recording; fixture data is never presented as live.

## Execution (the agent's own wallet signs)

| Tool | What it does |
|---|---|
| `build_guarded_swap` | Builds an **unsigned** buy through ShareGuard, the contract that reverts the whole transaction if the buyer would receive fewer shares than the quote's floor. Covers the assets ShareGuard has enabled (see `/docs` for the current list). |
| `build_sell_swap` | Builds an **unsigned** sell to USDT. It goes through the allow-listed router, so the protection is the router's own minimum-receive amount, not the share floor. Only enabled when the server turns selling on. |
| `get_receipt` | Reads the result of a transaction: shares received against the floor, from the chain's logs. Only enabled when receipts are on. |

No tool signs, sends or holds keys. The agent's wallet (a Binance Agentic Wallet, an Agent Studio wallet, or any other) previews and signs what the tool returned. Tally never sees a key.

## What it does not do

- It does not give advice, and its copy states facts only.
- It does not cover stocks outside those tokens, and it does not route between two stock tokens directly (the aggregator refuses that pairing).
- ShareGuard enforces the share floor for buys only. Sells carry the router's minimum-receive protection.
- It is not a custody or signing service, and it does not trade on its own. Autopilot is not built.
- There is **no hosted endpoint today**. The MCP server runs as a local process (stdio). A remote HTTP endpoint is planned (see `docs/work-orders/WO-05-agent-layer.md`, slice C) and is not promised.

## How an agent uses it today

Run the MCP server beside the agent: see `packages/mcp/README.md` for the Claude Code, Cursor and BNB Agent Studio setup, the offline fixture mode and a one-shot command line. The Wallet Skill in `skills/share-true-trading/` tells the agent when to call each tool and how to confirm a plan before signing.

## Notes for later

Paying per call (x402), an onchain identity and task listing (ERC-8004 and ERC-8183 through BNB Agent Studio) and a signing session limited to the router and a daily amount (for example an Altana session key) are possible next steps. None of them is built or claimed.
