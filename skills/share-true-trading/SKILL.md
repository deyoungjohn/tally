---
name: share-true-trading
description: Compare tokenized stocks on BNB Chain in share units and prepare a Tally ShareGuard buy for execution through Binance Agentic Wallet after explicit confirmation. Use for issuer comparisons, buying a share amount, and checking the resulting fill in shares.
---

# Share-true trading

Use Tally's MCP tools to compare bStock, Ondo and xStocks in tokenized **shares**, then use the installed `binance-agentic-wallet` skill and `baw` for preview and execution. Tally never signs or sends a transaction. This skill covers manual buys on BSC (chain 56); sell, switch and autopilot belong to their own workflows.

Read [the setup and live runbook](../../packages/mcp/README.md) for tool parameters, CLI equivalents and a complete $6 test. Obtain addresses through `baw wallet address --json` and choose the entry with `binanceChainId: "56"`; inspect connection, balances, daily quota and security settings using Agentic Wallet's wallet commands. Developer Mode must be enabled by the user in the Binance App before contract-call preview. Never ask for keys, seed phrases or credential-bearing RPC URLs.

## Resolve and compare

1. Call `get_consolidated_quote` with the ticker and **one** of `usd` or `shares`. Resolve token addresses only through Tally's registry. Company names must first be resolved to a ticker; if ambiguous, ask the user.
2. Show each issuer's price per share, premium (fraction ×100 for percentage display), estimated network fee, route, integrity grade and reasons. Select the engine's `best` flag: it ranks **effective cost per share, including gas**, rather than token price or hop count. Explain missing fees/reference data and any degraded source.
3. For a share request, use the winning row's `amountInUsdt` (raw 18 decimals) as the spend estimate; do not redo share math in floating point. Preserve the requested share floor as a decimal string. Enforce **at least 6 USDT**. If the requested amount costs less, explain the $6 minimum and obtain agreement to the larger spend and share amount; never silently increase the order.
4. Inspect `get_integrity(ticker)` and freshness. A ghost market, pause, failed multiplier bounds or unavailable share count blocks execution. xStocks is display-only on BSC even when an API labels it `TRADING`. A quote is an estimate, not a fill.

## Source of truth

- **bStock:** on-chain `uiMultiplier()`. API/list fallbacks are labelled degraded, with their missing-source reason; they do not replace ShareGuard's on-chain check.
- **Ondo:** the engine's accepted API/list reading, checked against its previous accepted baseline and corporate-action/price sanity rules. Ondo has no on-chain multiplier getter. ShareGuard uses a bounded, fresh stored feed. MCP has no feed signer: if an update is needed, stop with “share data is being refreshed / use the web app.”
- **xStocks:** on-chain `multiplier()` for display; API/list disagreements remain visible. Never select xStocks for a buy through Tally.
- **Unknown:** keep `shares: null` and its reason. Never assume one token equals one share. `get_shares_of` includes source per row and retains zero balances; its default ticker scope is stated in the result. Use `tickers` to inspect additional registry tickers.

## Build without signing

Call `build_guarded_swap` with `ticker`, `issuer` (`bstock` or `ondo`), `usdtAmount`, `wallet` and `recipient`. Recipient must equal the signing wallet. Provide **either** a decimal-string `minShares` (an **at least** constraint) **or** `tolerancePct` in percent (0.1–5, default 1). The wrapper derives tolerance from the quote and verifies the fresh plan's actual floor. `floor_not_achievable` is a stop: never lower the user's floor or raise their spend automatically.

The deployed ShareGuard is `0x28F6F19bffbF25E36452c78d12090F0bC922970a`. Buyable assets depend on its configuration (currently NVDA, AAPL, TSLA, QQQ and SPY); registry presence alone does not authorize a trade.

- `needs_funds`: show the exact USDT/BNB shortfall and stop. Do not substitute assets or top up without instructions.
- `needs_approval`: preview `approve.to`/`approve.data`, show the spender (ShareGuard) and **exact** amount, explain the authority change, and obtain explicit confirmation before executing that preview. Never approve the router directly or use unlimited approval. Wait for the approval to confirm, then call the builder again with the **same intent**. The approval is not permission to execute the buy.
- `ready`: show the exact floor used (`floorShares`), spend, issuer, multiplier/source, route, recipient, premium, gas limit, expiry, warnings and issuer/smart-contract/price risks. `factsToShow` supplies these. Decode/check the function is `swapForShares`, destination is the deployed guard, token input is BSC USDT, amount/floor/recipient match the plan and router is allow-listed. Tally's engine already verifies the router configuration and simulates.

Gas is the engine's RPC estimate **from this wallet ×1.25**, simulated at that exact limit. The quote/swap API's repeated `450000` is not an execution limit. Check `baw contract-call preview --help` before previewing. Whenever it lists `--gasLimit`, pass `--gasLimit <plan.tx.gasLimit>` so preview and execution use the limit Tally simulated. If the flag is unavailable, omit it and state in the facts shown that the sent limit is baw's own and may differ from Tally's simulation. Record the help result and actual preview/execute command lines in the live-evidence PR. Never pass unsupported gas-price options.

## Preview, confirm, execute

Follow Agentic Wallet's [external-sign reference](https://github.com/binance/binance-skills-hub/blob/main/skills/binance-web3/binance-agentic-wallet/references/external-sign.md):

```bash
baw contract-call preview --help
baw contract-call preview --binanceChainId 56 --from <wallet> --to <plan.tx.to> --value 0 --inputData <plan.tx.data> --gasLimit <plan.tx.gasLimit> --json
```

Use the preview command's `--gasLimit` only when help lists it; otherwise follow the disclosure above.

Show `parsedTx`, `simulationResult`, `risks`, `authorityChanges` and Tally's share floor. Check preview success and a usable `requestId`. A preview error/interception stops the flow. If parsing does not expose the guard call, present the locally decoded fields alongside the preview and explain the parsing limitation; do not invent parsed facts.

Ask for **explicit confirmation of this buy** after the preview. Rebuild if the plan is older than about **90 seconds**; the on-chain deadline is **300 seconds** and the share floor protects the price. The engine's 15-second quote freshness check applies when creating the plan, not to this review window. Check the actual calldata deadline as well. If the plan is older than about 90 seconds or its deadline has passed, rebuild and re-preview; show the new facts and obtain confirmation for that new request. Do not execute a stale preview, silently change issuer/floor/spend/recipient, or reuse approval confirmation for the swap.

```bash
baw contract-call execute --requestId <successful-preview-requestId> --json
```

Run only after confirmation. If `PENDING_CONFIRMATION`, have the user approve in the Binance App and track that same order; never submit another buy. Persist the resulting transaction hash before polling. Do not retry failed or ambiguous execution automatically. Fixture results (`fixtures: true`, `source: recorded-fixtures`) and pseudo hashes must **never** be executed against a real wallet.

## Verify the receipt

Use the WO-02 `get_receipt` tool when installed, or the unsigned CLI `receipt` command documented in the runbook (calls existing `engine.trade.receipt`). Poll a pending receipt without resubmitting the transaction. Decode the deployed guard's `Guarded` event and report **shares received**, amount spent, USD/USDT per share, premium versus the US reference, gas and the hash/BscScan link. Use the event's multiplier for that fill; a later dividend does not rewrite historical shares.

An absent event or mismatched stock/user/input is unreconciled, not proof of a successful share-true fill. A reverted transaction spent no USDT on the buy but may have cost gas. Keep the hash and explain the status. Do not infer shares from a wallet's aggregate balance change.
