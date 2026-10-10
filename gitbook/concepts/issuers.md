# The three issuers

| | Ondo | bStock | xStocks |
|---|---|---|---|
| Symbol suffix in Tally | `on` (NVDAon) | `B` (NVDAB) | `x` (NVDAx) |
| Multiplier on-chain | No (API only) | Yes, `uiMultiplier()` | Yes, `multiplier()` |
| Pause check | `tokenPauseManager().isTokenPaused(token)` | Shared manager `isTokenPaused(token)`; the token itself has no pause getter | `isPaused()` on the token |
| Executable in Tally | Yes | Yes | No (ghost market) |
| Typical volume on BNB Chain | Moderate | Highest | Almost none |
| Reference price | Public RWA data | The API returns `null`, so Tally borrows the same ticker's reference from another issuer | |

## How the same ticker differs

* **Price per share** is usually within about 0.1% across issuers during US regular hours (Ondo median +0.004% against the US price, bStock +0.062% in the 30 September snapshot). The cheapest issuer changes minute to minute and with order size, so Tally quotes live. In the recorded NVDA quote ladder, Ondo won at $6, $25 and $100 and bStock at $1,000.
* **Routes differ.** The aggregator returns one route from one vendor (LiquidMesh) for stocks. Many Ondo buys route through the bStock pool, so "buying Ondo" often means buying bStock first and swapping on.
* **Trading hours.** Ondo asks for a signed (RFQ) order outside its trading sessions, and Tally cannot send those yet. In Tally, an Ondo token is treated as closed when its live quote says so. See [Selling and Migrate](../modules/selling-and-migrate.md).

## What "ghost market" means

A token with under $1,000 of 24-hour on-chain volume is a ghost: its quoted price can be days old. This applies to Ondo too (NFLXon traded $16 in the 30 September snapshot). Tally flags it as a ghost, labels it Not Tradable and will not execute against it, which is why some tickers have only one tradable issuer.

## Enabled on ShareGuard

Buying also requires the token to be enabled on the ShareGuard contract. On 8 October 2026, 12 of the 21 supported tickers had only one issuer enabled. Tally checks per token, not per ticker. See [Deployments and enabled assets](../smart-contracts/deployments.md).
