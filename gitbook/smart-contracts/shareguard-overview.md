# ShareGuard overview

ShareGuard is the one contract Tally deploys. It is **slippage protection measured in shares of the stock, not in tokens.**

{% hint style="info" %}
Contract: `0x28F6F19bffbF25E36452c78d12090F0bC922970a` on BNB Smart Chain. Source: [`contracts/src/ShareGuard.sol`](https://github.com/deyoungjohn/tally/blob/main/contracts/src/ShareGuard.sol) (Solidity 0.8.28, about 480 lines, OpenZeppelin 5.4). Unaudited.
{% endhint %}

## The problem it solves

A normal swap protects you with a minimum amount of *tokens*. But one token is `multiplier` shares, and the multiplier differs per issuer and moves over time. A minimum of "0.025 tokens" means a different number of shares for Ondo and for bStock. ShareGuard states the floor in shares and enforces it on-chain.

## The shape of it

ShareGuard is the **trader**:

1. It pulls the input token (USDT) from the caller.
2. It calls an allow-listed router with the aggregator's calldata, which was built with the *guard* as the wallet.
3. It measures what arrived, converts to shares with the token's multiplier, and **reverts the whole transaction** if shares are below `minShares`.
4. It forwards the stock tokens to the recipient and refunds any unspent USDT.

It holds no balances between transactions, and an approval to it is for exactly the amount being spent and is reset to zero afterwards.

## What it is not

* **Not upgradeable.** No proxy, no admin-controlled logic change. A new version is a new deployment.
* **Not a router.** It calls the Binance aggregator's router; it does not find routes.
* **Not a custodian.** Nothing is held between transactions. `rescue` can sweep tokens sent there by mistake, and cannot run inside a swap.
* **Buys only.** Sells use the router's own minimum-receive amount. The share floor exists for buys.

## Public interface

| Function | Who | Purpose |
|---|---|---|
| `swapForShares(tokenIn, amountIn, stock, minShares, router, routerData, recipient, deadline)` | anyone | Guarded buy for assets whose multiplier is on-chain (bStock). |
| `swapForSharesWithFeed(…, FeedUpdate u, bytes sig)` | anyone | The same, with a signed multiplier update for Ondo assets. |
| `sharesPerToken(stock)`, `toShares(stock, tokens)` | view | The multiplier the guard would use right now. |
| `isTokenPaused(stock)` | view | The issuer's pause state; reverts if it cannot be answered. |
| `assertMinShares(account, stock, balanceBefore, minShares)` | view | Post-trade check for a wallet that trades itself and calls this in the same transaction (an EIP-7702 batch). |
| `assetOf(stock)`, `feedOf(stock)`, `allowedRouter(r)`, `approveTargetOf(r)` | view | Configuration and feed state. |

Owner functions are listed in [Admin powers and safety](admin-and-safety.md). The step-by-step of a swap is in [How a guarded swap works](how-a-guarded-swap-works.md).

## Lineage

An earlier prototype (`spike/shareguard/`) proved the idea on a mainnet fork but called any caller-supplied address, which let an attacker aim it at a token contract and drain anyone who had approved it. ShareGuard v1 fixes that with an owner-managed router allow-list, and a fork test (test G) proves the attack reverts. The prototype must never be deployed.
