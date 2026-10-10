# Security model

{% hint style="warning" %}
**ShareGuard v1 has not been independently audited.** It has unit, fuzz and mainnet-fork tests, and live guarded buys on mainnet, but nobody outside the team has reviewed it. Use test amounts.
{% endhint %}

## What is trusted, and what is not

| Component | Trusted for | Not trusted for |
|---|---|---|
| Your wallet | Signing | Anything else |
| Tally's server | Building transactions, reading data | Holding funds or keys: it has none |
| Binance Web3 API | Quotes and swap calldata | Gas numbers, prices as truth, or being reachable from everywhere |
| ShareGuard | Enforcing the share floor onchain | Being safe against a compromised owner (see below) |
| The router | Executing swaps | Anything: ShareGuard checks what arrived |
| Issuers' multipliers | Being the reference | Staying consistent across sources |

## Keys

* The user's keys never touch Tally. Embedded-wallet export opens Privy's own dialog.
* `BINANCE_W3_API_SECRET`, `PRIVY_APP_SECRET`, the Telegram bot token and the feed-signer key live only in the server's root-only environment file. They are never in git, logs or fixtures.
* The **owner key** (contract admin) and the **deployer key** are held by the chief engineer on their own machine and are used only by `forge` through an encrypted keystore. Agents and the server never see them.

## The contract's threat model

* **Arbitrary calls.** The prototype called any caller-supplied address, so `router = USDT, data = transferFrom(victim, …)` could drain anyone who had approved it. ShareGuard allow-lists routers and approve targets, and a fork test proves the attack reverts.
* **Reentrancy, deadlines, exact approvals:** the contract is non-reentrant, deadline-bound, uses exact approvals reset to zero, and holds no balance between transactions.
* **A compromised feed signer** can only move an Ondo multiplier within its per-update bound (capped at 10% by the contract and configured at 3% for the Ondo tokens), only forward in time, and never past the owner's corporate-action rules. See [Multiplier sources](../smart-contracts/multiplier-sources.md).
* **A compromised owner** can change allow-lists and asset configuration, pause the contract, and rescue stray tokens. That is real power. The contract is `Ownable2Step` (ownership moves only when the new owner accepts it) and is not upgradeable.

## Off-chain controls

* **Region gate** at the edge, fail-closed, with a dated declaration stored without the IP address.
* **Origin checks** on routes that accept hints from the browser: the request origin must equal the app's origin.
* **Per-IP rate limits** on every public route.
* **Verified sessions** for anything that writes per-user state.
* **Plain errors:** a worker's raw error text is shown only in logs. Health responses remove URLs from provider errors.

## What we do not claim

* We do not claim MEV protection: the API exposes that option only on its own broadcast endpoint, and users sign and broadcast in their own wallets.
* We do not claim that prices are fills. See [Share-true quotes](../concepts/share-true-quotes.md#honest-limits).
* We do not claim Ondo's off-hours sessions work: market-maker orders need a signature Tally cannot send yet.
