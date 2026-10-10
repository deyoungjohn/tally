# Binance API behaviours we verified

Engineering notes from building on the Binance Web3 API, Agentic Wallet and the issuers' contracts. Every row is something we observed and recorded, with a pointer. This is a reference for people integrating the same APIs; it is not the hackathon's Developer Experience Report.

## Trading API

| Observed | What Tally does |
|---|---|
| Errors arrive as **HTTP 200** with the failure in the JSON `code`. | Always check the code. 40301 to 40304 are one region-block kind. |
| The region block is `40304`; the docs list 40301 to 40303 but not 40304. A call with no key gets `40101` before any region check. | Calls come from Seoul; users are gated at the edge. |
| A stock-to-stock swap is refused with `40368`. | Migrate is two steps. |
| Ondo is documented as RFQ but returned `executionMode: SWAP` in every recorded run. | An RFQ path exists in code and tests for the day it appears. |
| Ondo's minimum is "5 USD", checked in dollars. 5 USDT was refused (`40375`); 6 always worked. | The minimum buy is 6 USDT. |
| The gas figure is always 450,000. | Estimate, add 25%, simulate at the exact limit. |
| One route from one vendor per stock quote; routes change minute to minute and cross other assets. | Quote each issuer's token ourselves. |
| 30 back-to-back calls got `42900` after about five. | Paced client with backoff. |
| Error envelopes differ across modules, and two of our own request mistakes came back as `50000` server errors. | Per-endpoint error mapping. |
| The documented Market `price` and `candlestick` paths did not work as documented. | Not used. |
| The authenticated RWA list had 488 of 675 BNB Chain tokens and ignored every paging parameter. | The registry comes from the public lists. |
| `referencePrice` is per token, not per share (Ondo NFLX 680.80 for ten shares of 68.08). | Divide by `tokenToShareRatio`. |
| `enableMevProtection` exists only on the broadcast endpoint. | Not claimed: users broadcast in their own wallet. |
| The public K-Line's "reserved" field is the day's USD volume; it is `0` for every Ondo token. | Used for bStock only, with another source for Ondo. |

## Issuer tokens

| Observed | What Tally does |
|---|---|
| One token is not one share; multipliers differ per issuer and change. | See [The unit trap](../concepts/the-unit-trap.md). |
| bStock's on-chain multiplier matched the API; xStocks' did not (1.001701 against 1.000918 for NVDAx). | Read on-chain where it exists and compare. |
| bStock has no pause getter; a shared manager contract decides. Ondo's pause is read from the token. | ShareGuard reads both and fails closed. |
| A rebasing balance drifts from what a wallet service shows (0.08% for NVDAB). | Size an action from the chain balance. |
| Ghost markets exist for Ondo too (NFLXon traded $16 in 24 hours). | Not executable. |

## Agentic Wallet (`baw`)

| Observed | Consequence |
|---|---|
| An unattended sale executed through `contract-call preview` then `execute` with no app tap in Developer Mode. The approval did not count against the quota; the sale counted its USD value. | An agent can act within limits. |
| The app's minimum daily limits are $1,000 for DEX and Developer Mode. | A cap refusal cannot be tested with small money; Tally's own caps are the real rail. |
| `--gasLimit` is "a cap, not a bypass", simulated at that limit and passed on preview only. | Plan gas ourselves. |
| The session signs out after 48 hours of inactivity. | Check before every attempt. |

The full list with pointers is in the repository's [`docs/devex.md`](https://github.com/deyoungjohn/tally/blob/main/docs/devex.md).
