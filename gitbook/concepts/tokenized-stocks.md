# Tokenized stocks on BNB Chain

A tokenized stock is an ERC-20 token that tracks the price of a US stock. Three issuers list them on BNB Smart Chain, and Binance's Web3 wallet exposes them through its RWA (real-world asset) data and trading APIs.

## What the token is

* **A price tracker, not the share.** Holding NVDAB or NVDAon does not make you a shareholder of Nvidia. Issuers hold the underlying asset or hedge it, and publish attestation reports (Ondo daily and monthly; bStock a collateral report).
* **Permissioned underneath.** All three issuers use blocklists, not allowlists: Ondo through `compliance()` with `isBlocked` and `isSanctioned`, bStock through a blocklist and sanctions list behind role-based access, xStocks through `sanctionsList()` and `isPaused()`. Contracts can hold and send these tokens; we proved it with simulated transfers (6 of 6 passed) and with the live guarded buys.
* **Pausable.** Issuers can pause a token, for example around a corporate action or a trading-session change. A paused token cannot be bought through Tally, and ShareGuard refuses it onchain.

## Where the market is

Measured on 30 September 2026 (US regular session): 517 tickers across 675 BNB Chain tokens (Ondo 458, bStock 87, xStocks 130). 38 tickers are listed by all three issuers and 120 by at least two. Over 24 hours across those 38 shared tickers, bStock traded about $48.3M onchain, Ondo about $4.3M and xStocks about $96. That last number is why xStocks tokens on BNB Chain are treated as a ghost market: shown as data, never executable.

{% hint style="info" %}
Numbers on this page are from dated snapshots in the repository ([`IDEAS.md` §F1](https://github.com/deyoungjohn/tally/blob/main/IDEAS.md)). They change; Tally re-reads them from the chain and the APIs at runtime.
{% endhint %}

## Why a token interface is not enough

Three facts make a plain swap interface misleading for these tokens:

1. **The unit differs per issuer and per day.** See [The unit trap](the-unit-trap.md).
2. **The sources disagree.** The same token's multiplier can differ between the list API, the dynamic API and the contract. See [Integrity grades](integrity-grades.md).
3. **Some markets are dead.** A token with almost no onchain volume can quote a price that is days stale. Tally refuses to execute against those.
