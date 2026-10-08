# Developer experience: evidence log

This file collects **evidence only**: what we observed while building Tally on Binance's APIs, Agentic Wallet, the issuers' tokens and a few other tools, with a pointer to where each fact is recorded. It is **not** the Developer Experience Report. The report is written by the chief engineer, in their own words, because the hackathon rejects AI-written reports. Everything here is a fact to check and use; nothing here is a judgement or advice. Every item names its source so it can be reproduced. Dates are 2026. Add new items at the end of their section.

## Binance Web3 trading API

| # | What we observed | Pointer |
|---|---|---|
| 1 | Errors arrive as **HTTP 200** with the failure in the JSON `code`, so a client that checks only the status never sees them. | IDEAS.md §F4, §F10 |
| 2 | The region block answers `40304` ("Service not available due to compliance restriction"). The docs list `40301`, `40302` and `40303` but never `40304`, the code callers actually get. A call with no key gets `40101` before any region check, so a block can only be recorded with a valid key from a blocked IP. Romania, not on the hackathon list, is blocked too. | IDEAS.md §F10 (region table), `spike/region_report_ec2-seoul.json` |
| 3 | A stock-to-stock swap is refused with `40368` ("Ondo asset on chain 56 can only pair with allowed stablecoin(s)"), for every Ondo/bStock pair we tried. A direct one-transaction move between issuers is therefore impossible through the API. | MODULES.md §5 (gate V-B1) |
| 4 | Ondo is documented as RFQ (EIP-712 plus `order/submit`). In practice a quote without a wallet fails with `40001`, and with a wallet it returned `executionMode: SWAP`, `rfq: null` in every run. | IDEAS.md §F4 |
| 5 | Ondo's minimum order is "5 USD", checked in dollars: 5 USDT was refused with `40375` because USDT trades at about $0.9995. 6 USDT always worked. | IDEAS.md §F4 |
| 6 | The API's gas figure is a placeholder: every quote and swap said 450,000 whatever the route; real usage ranged from about 438,000 to 1,024,000, and a buy sent with the API's 450,000 gas reverted (the failed transaction is described in §F6). The displayed fee follows the placeholder. | IDEAS.md §F4, §F6 |
| 7 | The "aggregator" returned one route from one vendor (LiquidMesh) for every stock quote, so it offers no price comparison between issuers. Routes change minute to minute and cross other stocks and crypto (many Ondo buys go through a bStock/Ondo pool). | IDEAS.md §F4 |
| 8 | Rate limit: 30 back-to-back calls from Seoul passed about 5, then every call returned `42900`. Which limit applies (IP, key or endpoint) is undocumented. | IDEAS.md §F10 (rate limit probe) |
| 9 | Error envelopes differ between modules (`{code,msg,data,success}`, the same without `success`, and `{status,type,code,errorData}` for the Market gateway), and two client mistakes of ours were reported as `50000` server errors. | IDEAS.md §F10 (probes) |
| 10 | The documented Market `price` and `candlestick` paths did not work as documented (`price` answered "method not supported" in another envelope; `candlestick` was a 404). | IDEAS.md §F10, `packages/binance/src/fixtures.test.ts` |
| 11 | The authenticated RWA list returned 488 tokens (442 Ondo, 46 bStock, 0 xStocks) against 675 on BSC in the public lists, with undocumented paging. It carries `statusInfo`, `tokenToShareRatio` and a reference price that the public lists lack. | IDEAS.md §F10 |
| 12 | `referencePrice` is per **token**, not per share: Ondo NFLX showed `tokenPrice` 6808.01, `referencePrice` 680.80, `tokenToShareRatio` 10, while the quote API priced the same token at 680.80. Binance's own list disagreed with its own quote API by 10×. | IDEAS.md §F10 |
| 13 | Schemas written from the docs failed on real data twice (`assetType` is `null` on some rows; `executionMode` sits at the top level of the swap response). A fallback that swallowed the failure hid it until we made every fallback report a warning. | IDEAS.md §F10 (other build findings) |
| 15 | `enableMevProtection` exists only on the broadcast endpoint, so a user who signs in their own wallet cannot use it; we do not claim MEV protection. | IDEAS.md §F10 |

## Public market data (K-Line)

| # | What we observed | Pointer |
|---|---|---|
| 16 | The public daily K-Line (`.../wallet/dex/market/token/kline/ai`) documents its sixth field as "reserved". In practice it is the day's volume in USD (for NVDAB it matched the 24 h volume in order of magnitude). | `spike/tally-wo09-sustained-volume.json`, `docs/prompts/wo09-shareguard-expansion.md` |
| 17 | For **every one of the 121 Ondo tokens** that volume is `0` on all 95 days, so the endpoint cannot show Ondo trading at all. | same |
| 18 | History is shallow: of 68 bStock tokens, 11 have 90 days of candles, 55 have 30 and 13 were listed in the last 30 days. The endpoint caps at 95 candles and omits calendar days with no trades. | same |
| 19 | "Raw 24 h volume" overstates tradable depth. NVDAon showed about $162,000 of raw daily volume; its USDT pools traded about $1,700 a day on about $9,700 of liquidity, and the bulk came from the NVDAB/NVDAon pool ($48,000 on $2,200 of liquidity). Of 189 tokens above $1,000 of raw volume, no Ondo token had a median of $1,000 a day in its best stable-pair pool with at least 90% of days at or above $1,000 over both the last 7 and the last 30 days; 23 bStock tokens passed the same test at $10,000 a day (not counting the 10 already enabled). | `spike/tally-wo09-sustained-volume.json` |
| 20 | Ghost markets are common: NFLXon had $16 of 24 h volume against NVDAB's $16.7 million, so a token can be listed and quotable but not tradable. | IDEAS.md §F10 |

## Issuer tokens (Ondo, bStock, xStocks)

| # | What we observed | Pointer |
|---|---|---|
| 21 | "One token" is not one share. Ondo tokens carry a multiplier (some 10 shares per token), bStock tokens a rebasing `uiMultiplier()` (NVDAB read 1.000778…), xStocks another scheme. The multiplier changes over time (largest step seen +0.58%). | IDEAS.md §F1, §F10 |
| 22 | bStock's `uiMultiplier()` read on chain matched the API; xStocks' `multiplier()` matched the 09-30 snapshot but not the API (1.001701 against 1.000918). | IDEAS.md §F10 |
| 23 | A rebasing balance drifts from what a wallet service shows: the Agentic Wallet listed 0.025440 NVDAB while the chain held 0.025420 (0.08% less), and a sell sized from the displayed balance was refused by our own plan check. | `docs/evidence/V-AW-live-sell.md` |
| 24 | bStock has no pause getter; a shared manager contract decides pauses. Ondo's pause is read from the token. Neither is in the API. | IDEAS.md §F11 |
| 25 | Ondo's multiplier is pushed to our contract by a signer. Using the wrong ShareGuard source number for Ondo made every Ondo buy fail with "share count can't be read right now" until the source was corrected to the Feed source (3). | PR #23, IDEAS.md §F11 |
| 26 | xStocks tokens have no market to exit on BNB Chain in the registry, so they can be shown but not sold. | IDEAS.md §F10 |
| 27 | Attestation reports: Ondo NVDA's report was 3.2 days old on a Friday, and a live run 18 minutes later showed no deduction for the same token; the cause is not proven. | IDEAS.md §F10 |

## Binance Agentic Wallet (`baw`)

| # | What we observed | Pointer |
|---|---|---|
| 28 | An unattended sell executed through `baw contract-call preview` then `execute` with no app tap (Developer Mode on, `requireConfirmation=false`), 1 second for the execute; the approval did not count against the Developer Mode quota, the sale counted its USD value ($6.108). | `docs/evidence/V-AW-live-sell.md` |
| 29 | The App's minimum daily limits are $1,000 (DEX trading and Developer Mode), $5,000 (DeFi, prediction markets) and $20 (x402), so a cap refusal cannot be tested with small money, and the wallet cap is not a tight rail for a small account. Settings cannot be changed from the CLI. | MODULES.md §5 (V-AW), `docs/evidence/V-AW-baw-policy.md` |
| 30 | The CLI has 149 help pages; none exposes a per-trade cap, a per-rule budget, a contract or function allow-list or a sell-only policy. Docs and CLI agree that out-of-policy actions are rejected or need a second confirmation. | `docs/evidence/V-AW-baw-policy.md` |
| 31 | `baw contract-call preview --help` describes `--gasLimit` as "a cap, not a bypass": the transaction is simulated at that limit and the same value goes on chain, and it is passed on preview only. | `baw contract-call preview --help`, `docs/evidence/V-AW-baw-policy.md` |
| 32 | The Agentic Wallet's session signs out after 48 hours of inactivity and at a maximum duration, so unattended use needs a check before every attempt. | `docs/evidence/V-AW-live-sell.md` |

## Other tools we depended on

| # | What we observed | Pointer |
|---|---|---|
| 33 | Privy: the server SDK's `verifyAccessToken` reply uses snake_case (`app_id`, `user_id`) while the docs page shows camelCase claims; the standalone function takes an object and the client method a string; the user lookup is `users()._get(id)`. A mock written from the docs passed every test and would have refused every real login. | `apps/web/lib/server/session.ts`, WO-06 review |
| 34 | BNB Agent Studio (read from public pages, not used): agents run on AWS Bedrock AgentCore with ERC-8004 identity and an ERC-8183 task interface; Altana session keys document spend limits, allowed contracts and expiry, enforced on chain. | project notes, 7 Oct |
| 35 | Next.js 16 renamed middleware to `proxy.ts`; behind a Cloudflare tunnel the request URL is `https://localhost:3000`, so a rewrite fails with `EPROTO`. | CLAUDE.md, `e2e/region-gate-tunnel.spec.ts` |
| 36 | Tailwind's build kept only the prefixed `-webkit-backdrop-filter` when both forms were written, and Chrome ignores the prefixed form alone, so every blurred surface lost its blur in production. | CLAUDE.md (Round 5 note) |
| 37 | GeckoTerminal's free API lists pools with volume and liquidity per pair and worked without a key (about 30 requests a minute), which filled the Ondo gap that Binance's K-Line leaves. | `docs/prompts/wo09-shareguard-expansion.md` |
| 38 | The public dynamic endpoint returned `stockInfo.price` null for all ten bStock tokens tried at 02:31 UTC on 8 Oct (outside US hours), so there was no independent per-share price to check a DEX quote against. `tokenInfo.price` was present but is the DEX price itself. Whether the field fills in during the US session is not yet known. | `contracts/captures/depth/bstock-reference-outside-us-20261008.json` |
| 39 | 10 of the 28 bStock tokens in Batch 1 were not in the authenticated RWA list at all in both capture runs ("must contain exactly one matching BSC token"), including AAPLB, which ShareGuard already supports, and two held ETF tokens (SOXSB, SQQQB). This is the truncation in item 11 showing up per token. | `contracts/captures/depth/batch1-20261008T000326Z/` (error stage `reference`) |
| 40 | For seven Ondo tokens the quote API returned HTTP 200 with an error code and no route: `40374` for HOODon, INTCon, METAon, MSTRon and SKHYon, `40367` for MRNAon and TSLAon (their integrity reading was "Paused for session transition"). Neither code is in the notes we hold, and the message text was not recorded. Other Ondo tokens quoted normally in the same minute. | `contracts/captures/depth/batch1-20261008T000326Z/*.json` (`quotes.6.eoa.quote.error`) |
| 41 | Two Ondo tokens (MSFTon, SNDKon) quoted with an absolute premium over 1.5% against the reference price per share at the same moment as tokens quoting under 0.1%. | the same run, assessment reasons |
| 42 | The first Batch 1 run hit `42900` (HTTP 429) once, on the reference lookup for MRNAon; the second run did not. | `contracts/captures/depth/batch1-20261007T233708Z/MRNAon.json` |
| 43 | The public dynamic endpoint's `stockInfo.price` stayed null for the same ten bStock tokens at 13:32 UTC, shortly after the US open, as it was at 02:31 UTC, so the null is not explained by time of day. Those tokens have no independent per-share price from the public API; the authenticated list that has one omits them (item 39). | `contracts/captures/depth/batch-2-us-session-results.json` (run `batch1-bstock-us-20261008T133231Z`) |
| 44 | Two Ondo tokens produced absurd premiums against the independent reference in the US-session run: MSFTon +295,494,235% and SNDKon +832% (from the recorded raw output, multiplier, decimals and reference price). A premium that large means one of the three inputs is inconsistent for those tokens; which one is not yet known. | the same results file |

## Open items to verify before citing

- Item 27 (attestation) and the exact limit behind item 8 are unproven.
- Item 34 comes from public pages and a README, not from running the product.
- Items 38 to 42 are one overnight capture (00:03 UTC); item 43 shows item 38 did not change in the US session; item 40 (`40374`) persisted too. Item 40 does not know the error messages. Item 44's cause is unknown.
- Counts in items 11, 18 and 19 are snapshots from 2026-10-02 and 2026-10-07 and will change.
