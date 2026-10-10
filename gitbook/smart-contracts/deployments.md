# Deployments and enabled assets

## ShareGuard v1

| | |
|---|---|
| Address | [`0x28F6F19bffbF25E36452c78d12090F0bC922970a`](https://bscscan.com/address/0x28f6f19bffbf25e36452c78d12090f0bc922970a) |
| Chain | BNB Smart Chain (56) |
| Deployed | 2026-10-02, block 125266385 |
| Owner | The chief engineer's wallet (`Ownable2Step`) |
| Feed signer | `0xDd3C5F463d71fb06D7bE749F904A4090E080f407` |
| Allow-listed router | `0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5` (also its approve target) |
| Verification | Verified on BscScan and Sourcify |

Deployment cost 12 transactions (the contract, the router and ten assets) and about 0.00021 BNB in total.

## Enabled assets

**Initial deployment (2 October):** NVDA, AAPL, TSLA, QQQ and SPY, each as bStock and Ondo (10 tokens).

**Batch 1 (8 October):** 20 tokens added through the owner script, in two batches of ten.

| Issuer | Tokens |
|---|---|
| bStock (12) | SPCXB, BABAB, GOOGLB, SKHYB, MSTRB, CRCLB, SNDKB, HOODB, MSFTB, INTCB, METAB, TSMB |
| Ondo (8) | SPCXon, GMEon, GOOGLon, CRCLon, AMZNon, BMNRon, TSMon, NFLXon |

An enabled-list comparison at block 126440096 (2026-10-08 11:59 UTC) found 30 enabled tokens across 21 tickers and no differences from the planned list. Three live $6 guarded buys followed (MSFTB, GOOGLon and TSMB), each delivering more shares than its floor.

**Batch 2:** six further bStock tokens (AMZNB, NFLXB, GMEB, BMNRB, MRNAB, FLNCB) passed the same gates against the engine's reference price. A pinned, hash-checked owner scope exists for them. Read `assetOf(stock)` on the contract for the current state; this page may lag.

**Held back:** eight leveraged and inverse ETF tokens (SOXL, SOXS, TQQQ and SQQQ, in both issuers) passed some checks and were left out on purpose.

## Why not more

Most tokens fail one of the gates in [Adding assets](adding-assets.md): no replayable route, no independent reference price to check the premium against, a premium above 1.5%, or a market that is paused or dead. Skipping them is the point of the gates.

## Why the product list is per token

Enablement is per token on-chain, so the app checks the token, not the ticker. On 8 October, 12 of the 21 tickers had only one issuer enabled, and a Migrate whose destination issuer is not enabled is refused before anything is sold.
