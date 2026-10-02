# Tally: architecture blueprint

> **Naming:** Tally was called **Parity** during ideation and validation. Code under `spike/` and `research/` keeps the old identifiers (e.g. `PARITY_PK`, the `"parity.shareguard.fork"` seed behind the fork test's fixed address). Don't rename them; they're historical and some are load-bearing.

> **"Buy tokenized shares, at the best prices."** (UI tagline, changed 2026-10-02: copy must never imply users buy the underlying shares.) Tally compares the same US stock across the three issuers that tokenize it on BNB Chain (Ondo, bStocks, xStocks). It quotes each one in **share units** (tokenized shares track a stock's price; they are not the underlying shares), routes your buy to the best true price, and settles through **ShareGuard**, a contract that reverts if you'd receive fewer **shares** than promised.

This document is the hand-off from the ideation and validation phase to the build phase. It is meant to be **self-contained**: a new session (human or AI) should be able to build Tally from this file, `DESIGN.md`, and the evidence they link to, without reading the earlier conversation.

| | |
|---|---|
| Status | Validated, ready to build (2026-10-01) |
| Hackathon | BNB Hack: Tokenized Stocks Edition (`bnbhackathon.md`) |
| **Submission lock** | **Sun 11 Oct 2026, 12:00 UTC** |
| Judging / winners | 12–23 Oct / week of 26 Oct. The repo, demo and deployed link must stay up through judging. |
| Companion docs | `DESIGN.md` (UI system) · `IDEAS.md` §Findings F1–F11 (evidence) · `spike/README.md` (how the tests were run) |
| Origin | Research and validation in [deyoungjohn/find-out](https://github.com/deyoungjohn/find-out) (PR #2); imported into this repo on 2026-10-01 |

---

## 0. How to use this document
1. **Read §1–§4 first** (what, constraints, verified facts, decisions). They explain *why* the architecture looks the way it does. Don't re-decide things listed in §4 without new evidence.
2. **Build in milestone order (§17).** Each milestone has an exit check. Don't start the next until the check passes.
3. **Read the evidence before changing anything it covers.** Every hard number here comes from a test recorded in `IDEAS.md` §F1–F9 or `spike/results/`.
4. **The user owns all private keys, accounts and the developer-experience report (§19).** Never generate, request or store their keys. The report must be written by the user; the hackathon rejects AI-generated reports.
5. **First prompt for a new build session:** see Appendix A.

---

## 1. Product summary

**The problem (measured, not assumed):**
- **The same ticker means different amounts of stock depending on the issuer.**
  - Ondo NFLX = 10 shares per token; bStock NFLX = 1.
  - Naive price comparison shows fake "arbitrage" of up to 899%.
- **Binance's own data disagrees with itself.** One xStocks token has three different multipliers depending on where you read it.
- **Where the volume is:** xStocks on BSC is a ghost market ($96 of 24h volume vs $48M for bStock).
- **Route quality changes minute to minute.** One minute apart on 2026-10-01, Nvidia cost **0.61% more per share** via bStock than via Ondo, on real mainnet buys.

**What Tally does:**
1. **Consolidated quote:** for a ticker and an amount ($ or shares), quote every issuer and show, per issuer:
   - shares you get;
   - price per share;
   - premium vs the US price;
   - the **real** network fee;
   - the route in plain words;
   - an integrity grade.
2. **Guaranteed-in-shares buy:** execute the best route through **ShareGuard**, which checks the result **in shares** on-chain.
3. **Portfolio in shares:** holdings across issuers in share units, with dividends shown as shares received (multiplier growth).
4. **Trap Shield:** live list of tokens that would mislead naive tools (unit mismatches, ghost markets, data disagreements, paused assets).
5. **Agent surfaces:** a Binance Wallet Skill and an MCP server, so AI agents get the same correctness layer.
6. **Telegram bot (read-only first):** quotes, Trap Shield and alerts in Telegram. Trading comes later, only through a Telegram Mini App.

**Who it's for:** people who already buy stocks on Robinhood or a local app and want them on-chain without learning crypto. The language is "shares", "price per share", "you pay"; never "slippage tolerance" on the main path.

**Why it can win** (from the 87-winner analysis, `IDEAS.md` §1):
- Precise financial primitives took 1st places (Faktura, Tilt, PRECEDENCE).
- 57% of winners are built around verifiable evidence.
- Fixing the sponsor's own tooling won 1st (Meld). The developer-experience report is 25% of this hackathon's score, and our findings already include the API's fixed `gas: 450000` reverting a real trade.

---

## 2. Hackathon constraints (must all hold at submission)
- **At least one of bStocks, Ondo or xStocks must be central.** Tally uses all three: bStock and Ondo for execution, xStocks for data and Trap Shield.
- **Spot only, no perps. BSC mainnet only.** Demo with small live amounts from the team's own funds.
- **Submission package:**
  - a public repo;
  - a demo video of 4 minutes or less (strongly recommended);
  - a deployed link or instructions a judge can follow;
  - a **Developer Experience Report**, worth 25% and human-written.
- **Scoring:**
  - Technical implementation: 30%
  - Creativity: 25%
  - DX report: 25%
  - Product quality and UX: 20% ("would it bring non-crypto-native users on-chain?")
- **Special prizes** ($2k each):
  - Best Use of Agentic Wallet / Wallet Skills: our target (§12).
  - Best Use of BNB Agent Studio: not targeted; Stipend is deferred.
- **Restricted participants and regions:** US, Canada, Netherlands, Iran, Cuba, North Korea, Crimea, Donetsk, Luhansk, UK, Japan (plus Binance's list). The app must block these (§9).

---

## 3. Verified facts that shape the design
Each fact links to its evidence in `IDEAS.md`. If a fact changes, update this table first.

| # | Fact | Design consequence | Evidence |
|---|---|---|---|
| V1 | Token ≠ share. Multipliers differ by issuer (NFLX Ondo 10.0 vs bStock 1.0; CRWD 4.0; SOXS 0.1017). 242/458 Ondo tokens ≠ 1. | All math is done in **shares**: `shares = tokens × multiplier`. | F1 |
| V2 | Multiplier sources disagree. bStock `uiMultiplier()` matches the API 38/38. xStocks on-chain `multiplier()` disagrees with the API on 12/38. Ondo has **no** on-chain multiplier. | Source of truth: on-chain for bStock and xStocks; API for Ondo, with bounds. | F1 |
| V3 | xStocks on BSC: ~$0 volume, stale prices from −90% to +865%. | Data and Trap Shield only. **Never route execution to xStocks.** | F1 |
| V4 | The multiplier grows with dividends (r = 0.917 vs yield across 26 Ondo tokens). | "Dividends received as shares" in the portfolio. | F1 |
| V5 | Issuer contracts use blocklists (sanctions), not allowlists. Contracts can hold, receive and send all three. | ShareGuard can act as the trader. | F2, F5 |
| V6 | The Trading API blocks by **caller IP**, across the whole API: US → `40304`, **sent as HTTP 200**. Seoul (KR), Nigeria and Mexico all work. | Backend in AWS Seoul. **Binance never sees our end users**, so the region gate is ours (§9). Always check the JSON `code`, never only the HTTP status. | F3 |
| V7 | Stock quotes return **one route from one vendor** (`LiquidMesh`, router `0xB444…dDA5`). Routes change minute to minute and pass through other stocks (SKHYB), BTC, ETH, BNB, and the other issuer (NVDAB → NVDAon). | Tally builds the cross-issuer comparison itself by quoting each issuer's token separately, and explains the route in words. | F4 |
| V8 | Ondo is documented as RFQ but behaved as plain `SWAP` in every run (pre-market and regular hours). A quote without a wallet fails with `40001 "userWalletAddress is required for RFQ (Ondo) quote"`. | Always pass a `userWalletAddress`. Keep an RFQ code path behind a check (§7.6). | F4 |
| V9 | Ondo minimum is **$5 in USD**, so 5 USDT is rejected (`40375`; USDT ≈ $0.9995). | **Minimum order 6 USDT** across the app. | F4 |
| V10 | **The API's `gas` / `estimateGasFee` is always 450000.** A 4-hop swap needed ~1.02M and **reverted on mainnet** (`0x1425ea42` FailedInnerCall). Real usage: 437,968 (1 hop) to 775,639 (4 hops). | Always estimate gas yourself: `max(estimate × 1.25, …)`, and **simulate at the exact limit you send**. Never show `tradeFee` as the fee. | F4, F6 |
| V11 | Quotes go stale (a 90-min-old capture failed to replay). A fill can come in 0.51% below a seconds-old quote. | **Re-quote right before the user signs.** Share minimum with a user-chosen tolerance (default 1%). | F5, F6 |
| V12 | ShareGuard works **as the trader** with real API calldata for **both** NVDAB and NVDAon (fork tests B and C, 7/7 runs). The EIP-7702 batch also works (D and E). | Primary design: ShareGuard as the trader. 7702 batch is a stretch path. | F5 |
| V13 | Live mainnet buys work end to end: 6 USDT → 0.025977 NVDA shares at 230.97 (bStock); 6 USDT → 0.026137 at 229.56 (Ondo, −0.12% vs US price). Gas ≈ $0.02–0.03 per buy at 0.05 gwei. | Demo-ready numbers. Top-up adds ~$0.10 BNB, enough for several buys. | F6, F7 |
| V14 | Public RPC `bsc-rpc.publicnode.com` started returning 403 to the EC2 box. | Dedicated RPC plus a failover transport. | F6 |
| V15 | The public `bapi` endpoints (no key) are undocumented. bStock's `stockInfo.price` is `null`, and `marketStatus` is only returned for Ondo. | Use the documented, authenticated RWA Data API as primary; public endpoints only as cross-checks. Take the reference price from any issuer token that has it. | F1 |

---

## 4. Decisions already made
| Area | Decision | Why |
|---|---|---|
| Entry | **Tally** is the hackathon entry. Stipend is a separate project, deferred, never part of Tally. | Every risk testable for Tally has been retired. |
| Language | **TypeScript** everywhere except contracts (Solidity / Foundry). | |
| Web | **Next.js (App Router), self-hosted on the AWS Seoul EC2.** Not Vercel: its default regions call Binance from blocked IPs (V6). | |
| UI | `DESIGN.md`: revenue.family base (glass, rounded, graphite), Linear motion, Mercury subtle motion, **beUI** components via MCP. | The UI is meant to be a headline strength. |
| Wallets | **Privy** preferred (Dynamic as fallback), subject to the M0 checks (§8.1). Embedded wallets **natively on BSC (chain 56)**: hard requirement. External wallet connect (incl. Binance Web3 Wallet) as fallback. | Non-crypto onboarding (20% of score). |
| Onboarding | **Browse first, no sign-up.** Sign up at "Buy". Top up only when the balance is short. | |
| Top-up | Tier 1: deposit to address (QR). Tier 2: connect a funded wallet. Tier 3: Binance Onchain Pay, **only if Binance grants a merchant code**. We never sponsor gas. | Sustainability; Onchain Pay needs merchant onboarding. |
| Execution | **ShareGuard as the trader** (V12). Only bStock and Ondo. xStocks excluded (V3). | |
| Gas | Estimate ourselves; simulate at the exact limit (V10). | |
| Region gate | One merged block list, enforced at the edge for the **whole site** (not just Buy). | §9 |
| Keys | **The user** creates the ShareGuard deployer/owner key and the Ondo feed-signer key. The build session never creates or handles them. | |
| Telegram | Read-only bot first. Trading later, only via a Telegram Mini App where the user signs in their own wallet. The bot never holds keys. | |
| Deferred | b402 paid endpoint, Stipend, Agentic Wallet 7702 batch path (stretch), Binance Agent Studio. | |

---

## 5. System architecture

```
                     ┌────────────────────────── Users ───────────────────────────┐
                     │  Browser (mobile/desktop)        Telegram app        AI agents
                     └───────┬────────────────────────────┬───────────────────┬───┘
                             │ HTTPS                       │ Bot API            │ MCP / Wallet Skill
                     ┌───────▼────────┐                    │                    │
                     │ Cloudflare edge │ cf-ipcountry → region gate (§9)        │
                     └───────┬────────┘                    │                    │
       AWS Seoul EC2 (KR)    │ Cloudflare Tunnel (no open ports)                │
 ┌───────────────────────────▼────────────────────────────▼────────────────────▼──────────┐
 │ apps/web (Next.js)                 apps/bot (grammY)          packages/mcp (MCP server) │
 │  ├ UI (DESIGN.md, beUI)             read-only commands,         tools → same core        │
 │  ├ Route handlers /api/*            alerts scheduler                                     │
 │  └ middleware: region gate                                                               │
 │                 │                          │                          │                  │
 │          ┌──────▼──────────────────────────▼──────────────────────────▼──────┐          │
 │          │ packages/core: share math · issuer registry · integrity ·          │          │
 │          │                consolidated quote · ranking · trade plan           │          │
 │          └──────┬───────────────────────────────┬────────────────────────────┘          │
 │          ┌──────▼──────────┐            ┌───────▼──────────┐   ┌─────────────────────┐   │
 │          │ packages/binance│            │ packages/chain    │   │ SQLite (fills,      │   │
 │          │ signed client,  │            │ viem + failover,  │   │ alerts, tg links,   │   │
 │          │ typed endpoints │            │ ABIs, multipliers │   │ cache snapshots)    │   │
 │          └──────┬──────────┘            └───────┬──────────┘   └─────────────────────┘   │
 └─────────────────┼───────────────────────────────┼───────────────────────────────────────┘
                   │                               │
        Binance Web3 API (web3.binance.com/build)  │ BSC mainnet RPC (dedicated + fallbacks)
        Trading · RWA Data · Market · Transaction  │
        · Wallet                                   ▼
                                  ShareGuard v1 ── LiquidMesh router ── pools / RFQ ── NVDAB / NVDAon …
                                  (user signs approve + swap in their Privy or external wallet)
```

**Key properties**
- **Every Binance API call comes from the Seoul server** (V6). The API secret never reaches a browser, the bot or an agent.
- **Users sign everything in their own wallet.** The server builds transactions; it never holds user keys or funds.
- **One engine (`packages/core`)** serves the web, bot and MCP, so numbers are identical everywhere.

---

## 6. Repository layout
pnpm workspaces, Node 22 LTS.

```
/
├─ apps/
│  ├─ web/                 Next.js app (UI + /api route handlers + middleware)
│  └─ bot/                 Telegram bot (grammY), read-only v1
├─ packages/
│  ├─ core/                pure TS, no I/O: share math, registry types, integrity, quote ranking, trade plan
│  ├─ binance/             signed Web3 API client, typed endpoints, error mapping, retries, fixtures
│  ├─ chain/               viem clients (fallback transport), ABIs, multiplier readers, simulate/estimate helpers
│  ├─ mcp/                 MCP server exposing Tally tools
│  └─ config/              shared tsconfig/eslint, region block list (§9), constants (Appendix B)
├─ contracts/              Foundry: ShareGuard v1, tests (unit, fuzz, fork A–I), deploy scripts
├─ skills/share-true-trading/SKILL.md     Binance Wallet Skill
├─ research/  spike/       ideation evidence (keep, read-only)
├─ DESIGN.md  TALLY_BLUEPRINT.md  IDEAS.md  README.md
```

**Tooling:**
- Vitest for TS unit tests; Foundry for contracts; Playwright for e2e and visual checks.
- ESLint + Prettier. `pnpm -r typecheck` in CI.

**Libraries:**

| Area | Libraries |
|---|---|
| Web framework | `next`, `react` |
| Styling and components | `tailwindcss` v4, shadcn CLI + beUI, `motion`, `clsx`, `tailwind-merge`, `lucide-react` |
| Data fetching | `@tanstack/react-query` |
| Blockchain | `viem` (+ `wagmi` if Privy needs it) |
| Wallets | `@privy-io/react-auth` (if Privy passes M0) |
| Validation | `zod` |
| Telegram | `grammy` |
| Storage | `better-sqlite3` |
| MCP | `@modelcontextprotocol/sdk` |

**CI** (GitHub Actions) runs on every push:
- typecheck, lint, unit tests;
- `forge test` (offline suites);
- Playwright at 375/768/1280.

Fork tests need an RPC secret and run on demand.

---

## 7. The engine (`packages/core`, `packages/binance`, `packages/chain`)

### 7.1 Binance Web3 API client (`packages/binance`), verified recipe
- **Base URL:** `https://web3.binance.com/build`
- **Headers:** `X-OC-APIKEY`, `X-OC-TIMESTAMP` (ISO-8601 UTC with ms, e.g. `2026-10-01T14:23:11.123Z`), `X-OC-SIGN`, `X-OC-RECV-WINDOW` (we use 10000).
- **Signature:** `base64(HMAC_SHA256(secret, timestamp + METHOD + "/build" + path + ("?" + query) + body))`. The `/build` prefix must be in the signed path, or you get `40102`.
- **Success** = HTTP 200 **and** `code` in {`0`, `"000000"`}. **Errors can arrive as HTTP 200** (V6), so map `code` to a typed error:

| code | Meaning (observed) | App behaviour |
|---|---|---|
| 0 | success | |
| 40001 | param error, incl. "userWalletAddress is required for RFQ (Ondo) quote" | Always send a wallet (placeholder for browse quotes, §7.4) |
| 40101 / 40102 / 40103 / 40104 | invalid key / invalid signature / timestamp outside the recv window (observed: check the clock) / key lacks permission | Page ops; show "quotes unavailable" |
| **40304** | "Service not available due to compliance restriction" (caller IP). Observed for US, NL and RO exits, always HTTP 200 (F10) | Page ops immediately: server region problem |
| 40301 / 40302 / 40303 | documented region codes: sanctioned jurisdiction / VPN or proxy detected / unusual IP activity. Never observed | Treated as a region block, same as 40304 |
| 40311–40314, 40434 | documented KYT (address risk) rejections. Never observed | `compliance` kind; show "this address can't be used" |
| **40375** | "Minimum order amount is 5 USD." | Enforce min 6 USDT before calling |
| 40367 / 40369 | documented: Ondo / bStock token unavailable (market hours). Never observed | Per-token "unavailable", other issuer still ranks |
| 40401 / 40462 | quote expired / swap–quote mismatch (documented) | Re-quote automatically once |
| **42900** | rate limit exceeded, HTTP 429 (observed after ~5 calls in 50 ms, F10) | Client paces at 4 req/s and retries twice |

- **Retries:** network errors, 5xx and 42900 get 2 retries with backoff (300 ms, 600 ms); never retry other 4xxxx codes. 40401/40462 are re-quoted by the caller, not retried by the client. *(42900 added 2026-10-02: it is transient, and the original rule would have failed whole quotes on a burst.)*
- **Pacing:** token bucket, burst 3 then 4 requests/s, until elevated limits are granted.
- **Fixtures:** record real responses (with keys stripped) for tests, including a 40304 and a 40375.

**Endpoints used.** Trading API and RWA Data paths are verified against recorded responses. Market, Transaction and Wallet paths come from `web3.binance.com/en/dev-docs/llms-full.txt` (2026-10-02) and were **probed on the Seoul EC2 the same day** (`probes_*.json`, IDEAS §F10): simulate, gas-price, block-height, token balances and aggregator history work; the Market `price`/`candlestick` paths do not work as documented.

| Module | Endpoint | Use in Tally |
|---|---|---|
| Trading | `GET /api/v1/dex/aggregator/quote` (`binanceChainId=56, amount, fromTokenAddress, toTokenAddress, userWalletAddress`) | Per-issuer quotes |
| Trading | `GET /api/v1/dex/aggregator/swap` (`+ quoteId, slippagePercent`) | Calldata for ShareGuard at confirm time |
| Trading | `GET /api/v1/dex/aggregator/approve-transaction` | Reference only; we approve ShareGuard ourselves |
| Trading | `GET /api/v1/dex/aggregator/history` (`txHash`) | Receipt enrichment |
| Trading | `GET /api/v1/dex/aggregator/supported/chain` | Health check (also detects 40304) |
| Trading | `POST /api/v1/dex/aggregator/order/submit`, `GET …/order/{id}` | RFQ path, only if V8 changes |
| RWA Data | `/api/v1/dex/market/rwa/tokens` (`tabId` sectors, `statusInfo`), `/price`, `/search`, `/underlying-profile` (`protections`, `tokenToShareRatio`), `/underlying-market` (corporate actions), `/platforms` | Registry, status, attestations, reference data |
| Market | `/api/v1/dex/market/price` (not a GET) and `/candlestick` (404) as documented: **don't work** (F10) | Ticker charts need another source (decide in M3). BNB price for the fee comes from a small BNB quote (verified) |
| Transaction | **Verified:** `GET /api/v1/dex/pre-transaction/{gas-price,block-height}`, `POST …/simulate` (body `{binanceChainId, evmTx:{from,to,data,value}}`). `…/gas-limit` returned a system error; `broadcast-transaction` untested | **Simulate the ShareGuard call before showing "Buy"**, alongside `eth_call`. Using it counts toward "modules used". |
| Wallet | **Verified:** `POST /api/v1/dex/balance/token-balances-by-address`. `GET …/all-token-balances-by-address` returned an empty list for a funded wallet | Portfolio (query the registry's tokens explicitly) |
| Public, no key (cross-check only) | `bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai?type=1|2|3`, `.../v2/.../rwa/dynamic/ai`, `.../rwa/asset/market/status/ai`, `web3.binance.com/bapi/defi/v4/.../token/dynamic/info/ai` | Multiplier cross-check, `stockInfo.price` reference, on-chain volume (ghost detection) |

**Rate limits are unknown.** Ask for the hackathon's "elevated rate limits" (§19), and cache aggressively (§7.7).

### 7.2 Issuer registry
- **Sources:** the RWA token list (authenticated) plus the public list API, `type` 1 = Ondo (`…on`), 2 = xStocks (`…x`), 3 = bStock (`…B`). Chain 56 only.
- **Record per token:** `{ticker, issuer, address, symbol, decimals, assetType, multiplierSource, executable}`.
  - `executable = issuer ∈ {bstock, ondo}` and not flagged ghost.
- **Contract addresses only ever come from the registry,** never from user input (anti-phishing). Refresh hourly; keep a snapshot in SQLite.

### 7.3 Multipliers (shares per token, 1e18 fixed point)

| Issuer | Source | Selector |
|---|---|---|
| bStock | on-chain `uiMultiplier()` | `0xa60bf13d` |
| xStocks | on-chain `multiplier()` (display only) | `0x1b3ed722` |
| Ondo | RWA API `sharesMultiplier` | — |

**Ondo sanity bounds** (off-chain, checked on every reading). Ondo has no on-chain multiplier, so every change in it is checked twice: by its size, and against the market.

*Steps.* Ondo multipliers move in single steps on distribution dates, not gradually. Measured between the 2026-09-30 and 2026-10-02 snapshots (`research/ondo-multiplier-steps.md`): **31 of 458 tokens changed, each in one step, none decreased, the largest step was +0.58% (USHY)**; bond ETFs on their monthly distribution moved +0.28% to +0.40% (HYG +0.40%, TLT +0.39%, AGG +0.34%, BIL +0.28%). Reverse splits do happen: SOXS (Ondo) has a multiplier of 0.1017. There is deliberately **no per-day growth cap**: a `dividendYield / 365 + ε` rule would have rejected all 31 observed updates (HYG's ~5.8% yield allows about 0.016% per day, and it stepped 0.40%).

1. **A single increase of up to 3% is accepted** (a **judgement threshold**, about five times the largest step seen, not derived from data; revisit it as more steps are observed), **unless the price check (below) runs and fails.**
2. **A decrease, or an increase above 3%, is accepted automatically only when all three hold:**
   1. **Status:** `statusInfo.reasonMsg` showed `stock_split` or `stock_dividend` within 48 hours of the change. The `reasonMsg` is a **bare code** with no ratio (tokenized-securities skill docs), so no ratio is ever read from it. Because a halt can end before the multiplier is next read, the sighting is remembered across runs (the baseline file, below); the change time is Binance's `lastUpdateTime` when it gives one, otherwise the time we noticed it.
   2. **Simple ratio:** `new / old` is within **0.5%** of a simple ratio: `n` or `1/n` for n in 2, 3, 4, 5, 8, 10, 15, 20, 25, 30, 50, plus 3/2 and 2/3. Test vectors: NFLX 10.0, CRWD 4.0, SOXS 0.1017 (from 1.017, 1/10).
   3. **Price check:** after trading has resumed (status open), `tokenPrice ÷ newMultiplier` is within **2%** of the US share price (`stockInfo.price`). Both prices come from the public RWA dynamic data (`tokenInfo.price`, `stockInfo.price`); the authenticated list's `tokenPrice` is not used, because for Ondo NFLX it is ten times the quote API's price. On real 2026-09-30 data this check is quiet: 28 Ondo tokens were all within 0.15% in a regular session (NFLXon 10×: +0.06%, CRWDon 4×: +0.01%), while the xStocks NFLX token with multiplier 10 fails at −89.8%.
   Until all three hold, **the token stays blocked and flagged** (Trap Shield). The owner's manual action (editing the baseline, or registering a `CorporateAction` in ShareGuard, §10) is only a fallback.
3. **The price check also runs on every other multiplier change, dividend steps included**, as a validation independent of every multiplier source. If it runs and fails, the step is blocked; if it cannot run (trading not open, or price data missing) the step is accepted on size alone and the check is logged as skipped. Its inputs (token price, multiplier, stock price, deviation, status) are always recorded in the integrity log (`multiplier-validation`).

Each reading is compared with the **last accepted reading** (the baseline), kept in `data/ondo-multiplier-baseline.json` (`value` + `seenAt` per token; SQLite later) and seeded from the 2026-09-30 snapshot. **Only readings that pass are stored**, so a bad reading cannot become the baseline. A token with no baseline yet is recorded on first sight only if its sources agree. The file also keeps the last corporate-action status sighting per token (`action`: kind, first and last seen); an accepted change consumes it.

Values that break the bounds are flagged in Trap Shield and block execution for that token. Cross-check every source against the public list/dynamic endpoints and record disagreements; they feed the integrity grade and the DX report.

### 7.4 Consolidated quote algorithm
**Input:** `ticker`, `amount` (`{usd}` or `{shares}`), optional `wallet`.

1. **Resolve tokens:** all registry tokens for the ticker on BSC. Executable ones are bStock and Ondo; xStocks is shown with its integrity grade and is never executable.
2. **In parallel per token:**
   - multiplier (§7.3);
   - status (`statusInfo`; `null` means "unknown" and is never assumed open);
   - integrity inputs.
3. **Reference price (per SHARE):** the authenticated list's `referencePrice ÷ tokenToShareRatio` from any issuer token of the ticker (it is a per-token value: Ondo NFLX shows 680.80 for 10 shares of $68.08, F10). Fall back to the public `stockInfo.price` (bStock returns `null`, V15). Mark the session: pre-market, regular, after hours, overnight or closed.
   - **Registry source:** the public lists (all three issuers); the authenticated RWA list returned only 488 of 675 BSC tokens and no xStocks.
4. **Amount to USDT:**
   - USD: `amountIn = usd`.
   - Shares: estimate `amountIn = shares × refPrice × 1.01`, quote once, then scale linearly and re-quote once.
   - Enforce **amountIn ≥ 6 USDT** (V9).
5. **Quote each executable token** via the Trading API with **`userWalletAddress = ShareGuard address`**. The executed route must be built for the guard (V12). The same address works as the browse-mode placeholder, because quotes don't depend on wallet history (F3).
6. **Compute per token:**
   - `tokensOut = toTokenAmount`
   - `sharesOut = tokensOut × m / 1e18`
   - `usdPerShare = amountIn × usdtPrice / sharesOut`
   - `premium = usdPerShare / refPrice − 1`
   - `hops = dexRouterList.length`
   - `routeText` (e.g. "USDT → BTC → USDC → NVDA (bStock)")
7. **Fee estimate for display:** a gas model calibrated from real fills (1 hop ≈ 440k, 2 hops ≈ 600k, 3–4 hops ≈ 780k–1.03M; refine with every fill) × current gas price × BNB price. Label it "≈". The exact estimate happens at confirm (§7.6).
8. **Rank** by effective cost per share = `(amountIn + fee) / sharesOut`. Tie-break: fewer hops, then better integrity grade. Mark the winner "Best" and show the saving vs the runner-up in USD and %.
9. **Cache** per `(ticker, amount bucket)` for 10s (§7.7).

### 7.5 Integrity grade (A–F) per token
Start at 100 and subtract:

| Condition | Points | Flag |
|---|---|---|
| Multiplier sources disagree by > 0.1% | 25 | |
| \|premium\| > 2% during regular hours | 30 | |
| On-chain 24h volume < $1,000 | 40 | ghost |
| Status unknown | 10 | |
| Status `pause` / `ASSET_PAUSED` | 50 | not executable now |
| Status `ASSET_LIMITED (earnings)` | 10 | |
| Attestation report older than 3 days (when `protections` exist) | 10 | |
| Multiplier ≠ 1 *and* a different issuer for the same ticker = 1 | 0, but adds the "unit trap" badge | |

Grades: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, F < 40. Every deduction is shown as a plain-English reason.

### 7.6 Trade plan (confirm and execute), web and Mini App
1. **Fresh quote + swap** for the chosen issuer token, with `userWalletAddress = ShareGuard`, `slippagePercent = user tolerance` (default 1%; offer 0.5 / 1 / 2).
   - If `executionMode ≠ SWAP` (RFQ), stop and show "This issuer needs a signed order. Try the other issuer." The RFQ path is P2.
2. **Share minimum:** `minShares = sharesOut × (1 − tolerance)`. The display explains: "You'll get at least 0.02588 shares or nothing happens."
3. **Allowance:** if `allowance(USDT, user → ShareGuard) < amountIn`, request an **exact-amount** approval (never unlimited) and wait for confirmation.
4. **Re-quote** if more than 15s have passed since step 1 (V11). Rebuild `minShares`.
5. **Gas:** `estimate = eth_estimateGas(user → ShareGuard.swapForShares(...))`, `limit = ceil(estimate × 1.25)`.
6. **Simulate** at exactly `limit` (`eth_call` with `gas: limit`) and with the Binance Transaction API. If either reverts, show the reason and don't ask for a signature.
7. **User signs** in Privy or their external wallet. Show progress in the `dynamic-island`.
8. **Receipt:** poll with failover (§7.8), decode the `Guarded` event, and show tokens received, **shares received**, USDT per share, premium vs US price, gas in USD and the BscScan link. Store the fill.

> **As built (M3):** steps 1 to 6 are `prepareTrade` in `packages/engine/src/trade.ts`, called as a state machine: the same endpoint answers `needs_funds`, `needs_approval` or `ready`, because the gas estimate and simulation only work once the allowance exists. The Ondo signed update is created inside the plan (no separate endpoint). The confirm sheet shows a 15 s countdown, re-quotes on confirm if it expired, and asks again if the guaranteed minimum moved by more than 0.1%. Privy's own wallet prompt is switched off (`showWalletUIs: false`).

**Error to UX mapping:**

| Error | UX |
|---|---|
| 40375 | "Minimum is $6" |
| 40304 | "Quotes are temporarily unavailable" (and alert ops) |
| simulation revert `InsufficientShares` | "Price moved more than your tolerance. Review the new quote." |
| `TokenPaused` | "Trading paused for a corporate action" |
| out-of-gas (shouldn't happen after step 5) | "Network fee estimate failed, nothing was spent" |

### 7.7 Caching
| Data | TTL |
|---|---|
| Registry | 1 h |
| Multipliers | 5 min (bStock/xStocks on-chain reads are cheap, Ondo bounded) |
| Status | 60 s |
| Reference price | 15 s |
| Quotes | 10 s per (ticker, amount bucket: 6, 10, 25, 50, 100, 250, 500, 1000 USDT, else exact) |
| Gas price | 30 s |
| BNB price | 60 s |

The web UI polls quotes every 10s while visible and stops when the tab is hidden.

### 7.8 Chain access (`packages/chain`)
- viem `fallback()` transport. A dedicated provider key (NodeReal, Ankr or QuickNode free tier) goes first, then `bsc-dataseed.bnbchain.org`, `bsc-dataseed1.defibit.io`, `bsc-rpc.publicnode.com` (V14).
- Receipt polling tolerates transport errors and never loses the tx hash; persist it before polling.

---

## 8. Wallets, onboarding and top-up

### 8.1 Wallet provider: M0 checks (Privy first, Dynamic as fallback)
All must pass before M3 starts:
1. **Native BSC embedded wallet:** create an embedded wallet on chain 56 and send a real tiny transaction (e.g. a 0-value self-transfer) from the app. No bridging, wrapping or other-chain default.
2. **External wallets:** Binance Web3 Wallet connects (WalletConnect inside the provider) and signs on BSC.
3. **Terms:**
   - acceptable-use policy reviewed for a ban on securities or regulated assets (tokenized stocks are securities);
   - the provider's restricted-country list added to §9;
   - whether its login or SDK is blocked in any country.
4. **Allowed origins:** the provider app accepts our domain (or the temporary tunnel URL during development).
5. **Optional:** EIP-7702 support for embedded wallets (one-signature approve + swap). This is a stretch goal (§16).

If Privy fails 1 or 3, switch to Dynamic and repeat the checks. Record the result in `IDEAS.md` §F9.

### 8.2 Flow
- **Browse:** no account needed. Quotes, Trap Shield and prices are all public (subject to the region gate).
- **Buy:** sign in (email, social, or connect a wallet), then the trade plan (§7.6).
- **Top-up**, shown only when USDT < amount or BNB < gas for ~3 buys:
  1. **Deposit:** show the BSC address with QR and copy. Text: "Send USDT and about $0.10 of BNB on **BNB Smart Chain (BEP-20)**." Big warning about choosing the right network. Watch the balance and continue automatically.
  2. **Connect a funded wallet** instead.
  3. **Card via Binance Onchain Pay:** hidden until Binance assigns a merchant code. If granted, consider Onchain-Pay "Easy" mode (BSC only), which can call a contract after the purchase, i.e. card → ShareGuard → stock in one flow.
- **Gas display:** "Network fee ≈ $0.02–0.03. Your BNB covers ≈ N buys."

---

## 9. Compliance and the region gate
**Merged block list,** stored in `packages/config/blocked-regions.ts` with the **source of each entry**:
- the hackathon list: US, CA, NL, IR, CU, KP, plus the Crimea, Donetsk and Luhansk regions, GB, JP;
- Binance Web3 API prohibited regions (see their page);
- issuer restrictions (bStocks, Ondo, xStocks);
- the wallet provider's list and the top-up provider's list (from §8.1).

**Wallet-provider review (Privy, M0, 2026-10-01; read from the live pages, re-read before submission):**
- **Terms of Service §7** require use "in compliance with all applicable … laws", and §7(9) forbids misleading or asset-diverting wallet configuration. No country list there.
- **Acceptable Use Policy (updated 2025-12-16)** lists as high-risk "persons located in, resident in, or a citizen of … Cuba, Iran, North Korea, and Syria, and the Crimea, Donetsk, and Luhansk regions", plus anyone on US, UK, EU or UN restricted-party lists. It also forbids acting as a custodian, payment institution or money transmitter without a licence. Tally is non-custodial (users sign everything), so this does not apply.
- **No explicit ban on securities or tokenized securities.** The policy is silent on offerings and broker-dealers, so the general "applicable law" clauses carry it. Risk accepted: Tally is a secondary-market, non-custodial comparison tool, and the copy never gives advice.
- **Result for §9:** Syria added to the block list (Privy AUP). Crimea, Donetsk and Luhansk were already listed. Whether Privy's SDK or login is technically blocked in any country is untested.
- **Cloudflare sub-regions:** the gate reads `cf-region-code` (ISO 3166-2, UA-43 Crimea, UA-40 Sevastopol, UA-14 Donetsk, UA-09 Luhansk), which needs Cloudflare's "Add visitor location headers" managed transform. **Unverified on our plan: the user must confirm it is enabled** (see `deploy/README.md`). Without it the gate blocks by country only and this limitation stands.

**Enforcement:**
1. **Edge:** Next.js middleware reads `cf-ipcountry` (Cloudflare) and, for blocked countries, returns a static "Not available in your region" page for the **whole site** and `/api/*`.
   - Unknown country (`XX`) or Tor (`T1`): also blocked.
   - Region sub-areas (Crimea, Donetsk, Luhansk) can't be resolved from country codes alone. Block `UA` sub-regions only if Cloudflare region data is available on our plan; otherwise document the limitation.
2. **Declaration** at sign-up (checkbox, versioned, stored): "I am not located in, a resident of, or a citizen of a restricted region."
3. **Bot:** `/start` requires the same declaration. Read-only data only.
4. **Product rules:**
   - secondary market only (no issuer mint or redeem);
   - no investment advice (copy says "compare", "best price now", never "should buy");
   - disclaimers in the footer and on the confirm step.

**Known residual risk:** VPNs bypass IP checks. Documented as accepted, as in Nexus's earlier review (`9143f9c5-verificaton-challenges.md`).

---

## 10. ShareGuard v1 (`contracts/`)
Start from `spike/shareguard/src/ShareGuard.sol` (proven on the fork) and harden it.

> ⚠️ **Spike vulnerability that v1 fixes: arbitrary call.** The spike's `swapForShares` calls any `router` with any `data` supplied by the caller. Anyone who has approved ShareGuard could then be drained: an attacker passes `router = USDT` and `data = transferFrom(victim, attacker, amount)`. *(M2 correction, IDEAS §F11: with `tokenIn = USDT` the spike's own "no output" check stops this; the working exploit sets `tokenIn` = the stock token so the pulled dust counts as output.)* **v1 only calls allow-listed routers and approve targets,** never a token contract as the router, and rejects `tokenIn == stock`. Fork test G proves every variant fails (and that the spike logic is drained on real USDT).
>
> **Status (M2, 2026-10-02): done.** Built in `contracts/` (see `contracts/README.md`); unit, fuzz and fork tests A–I pass; **deployed and verified at `0x28F6F19bffbF25E36452c78d12090F0bC922970a`** with two live guarded buys (IDEAS §F11). Interface as built: `swapForShares(tokenIn, amountIn, stock, minShares, router, routerData, recipient, deadline)` and `swapForSharesWithFeed(..., FeedUpdate u, bytes sig)`; `Asset{source, enabled, maxStepBps, pauseCheck, pauseManager}`.

### 10.1 Interface (sketch)
```solidity
function swapForShares(
    address tokenIn, uint256 amountIn,
    address stock, uint256 minShares,
    address router, bytes calldata routerData,   // router ∈ allowedRouter
    address recipient, uint256 deadline
) external nonReentrant whenNotPaused returns (uint256 shares);

function swapForSharesWithFeed(..., FeedUpdate calldata u, bytes calldata sig) // Ondo: pull-style signed multiplier
function sharesPerToken(address stock) external view returns (uint256);
function assertMinShares(address account, address stock, uint256 balBefore, uint256 minShares) external view; // 7702 path
```

### 10.2 Rules
- **Allow lists** (owner-managed, events on change): `allowedRouter[addr]`, `approveTargetOf[router]`, `asset[stock] = {source: UiMultiplier | Multiplier | Feed, enabled, maxStepBps}` (`maxStepBps` applies to Feed assets).
  - Initial router and approve target: `0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5` (the same address for both, V7).
  - Reject `router == tokenIn` or `router == stock`, or any router not on the list; reject `tokenIn == stock`, `minShares == 0` and `amountIn == 0`. A configured stock can never be a router or approve target (and vice versa).
- **Approvals:** approve `approveTarget` for exactly `amountIn`, reset to 0 after the call (forceApprove pattern).
- **Accounting** (as in the spike):
  - measure the stock balance change on the guard itself, revert if `NoOutput`;
  - `shares = out × m / 1e18`, revert if `shares < minShares`;
  - forward `out` to `recipient`;
  - refund unspent `tokenIn` to `msg.sender`.
- **The guard holds no balances between transactions.** `rescue(token, to)` is owner-only and evented, for accidental transfers.
- **Checks:**
  - `block.timestamp ≤ deadline`;
  - `whenNotPaused` (global emergency pause of *new* swaps; it can't trap funds, since none are held);
  - **token pause (fails closed; a check that cannot be answered reverts `PauseCheckFailed`):** per asset `pauseCheck` = `Manager` → `manager.isTokenPaused(stock)` → `TokenPaused`, where Ondo's manager is read from `token.tokenPauseManager()` on every swap and **bStock's is fixed in the asset config** (`0x9fc7…700a`; the bStock token has **no** pause getter, found by tracing a transfer, IDEAS §F11); `TokenFlag` → xStocks `isPaused()`.
- **Ondo multiplier feed (pull-style, no keeper gas):**
  - an EIP-712 `FeedUpdate{stock, multiplier, validAfter, validUntil}` signed by `feedSigner`;
  - accepted only if the per-update increase is ≤ that asset's own `maxStepBps` (**per-asset**, set by the owner, start: **300 bps**; distribution steps differ by stock, so there is no global limit). **A decrease is accepted only via an owner-registered `CorporateAction{stock, expectedMultiplier, notBefore}` whose `expectedMultiplier` matches the update** (a reverse split); so is an increase above `maxStepBps` (a forward split). The signer cannot make either on its own;
  - stored with `updatedAt` (block time of acceptance). Swaps on a Feed asset revert if `now − updatedAt > maxAge` (start: 3 days; owner-settable within 1 h–7 d) and no fresh update is supplied.
  - **Seed and monotonic (M2):** the first value of a Feed asset is **owner-seeded** in `setAsset` (no signed first value exists, and the deploy script has only the deployer key); it applies only while the feed was never seeded. An update older than the stored `validAfter` reverts, the identical update may be resubmitted, the same `validAfter` with another value reverts. `maxStepBps` is capped at 1000.
- **Ownership:** `Ownable2Step`. The owner can only manage lists, parameters, the feed signer, pause and rescue. **Not upgradeable** (no proxy); deploy a new version if needed.
- **Events:** `Guarded(user, recipient, stock, tokenIn, amountIn, tokensOut, shares, multiplier, router)`, `AssetSet`, `RouterSet`, `FeedUpdated`, `CorporateActionRegistered`, `Paused`.
- **Libraries:** OpenZeppelin `SafeERC20`, `ReentrancyGuard`, `Ownable2Step`, `Pausable`, `EIP712`, `ECDSA`.

### 10.3 Tests (must pass before deploy)
- **Unit:** the 9 spike tests, plus allow-list, pause, deadline, feed (bounds, monotonic, staleness, corporate action, bad signature, replay outside the validity window), rescue, ownership.
- **Fuzz:** amounts, multipliers (1e15–1e20), tolerance, refund maths.
- **Fork (real API calldata, `capture_route.py` ported to TS or kept in Python):**

| Test | Checks |
|---|---|
| A | route replays for a plain wallet |
| B | route works through ShareGuard (bStock and Ondo) |
| C | share shortfall reverts |
| D, E | 7702 batch path, atomic revert |
| F | route fits the gas limit we send (our estimate × 1.25, not the API's) |
| **G** | **the arbitrary-call attack (router = USDT, transferFrom victim) reverts** |
| **H** | a paused token reverts (simulate via `vm.mockCall` on the pause manager) |
| **I** | a stale or out-of-bounds Ondo feed reverts |

- **Deploy script** (`forge script`, `contracts/script/Deploy.s.sol`): reads `DEPLOYER_PK` from the environment on **the user's machine**, never the server (without it, a key-less simulation). Sets the router allow list, assets from `deploy/assets.json` (bStock: UiMultiplier + fixed pause manager; Ondo: Feed, 300 bps, owner-seeded from `deploy/seeds.json`, which `tools/gen_assets.py` writes and the script refuses when older than 2 h) and the feed signer (an address, never a key). Checks every asset prices and answers its pause check on live state before finishing. Verifies on BscScan (`--verify`).
- **Fork tests replay pinned to the capture's block** (archive RPC), so captures stay valid for days; `FORK_LATEST=1` for fresh ones.

---

## 11. Frontend (`apps/web`)
All visual rules live in `DESIGN.md`. This section covers structure.

| Route | Content | Auth |
|---|---|---|
| `/` | Landing (DESIGN §5.1) with live data | public |
| `/trade/[ticker]` | Ticker header, chart, trade card, issuer comparison, trade flow (DESIGN §5.2) | public to quote; sign-in to buy |
| `/portfolio` | Holdings in shares across issuers, dividends as shares, top-up (DESIGN §5.3) | signed in (or view any address read-only via `?address=`) |
| `/shield` | Trap Shield cards and table (DESIGN §5.4) | public |
| `/how-it-works`, `/faq`, `/legal/*` | Content | public |
| `/blocked` | Region block page | — |
| `/api/quote`, `/api/trade/plan`, `/api/trade/receipt`, `/api/fills`, `/api/declaration`, `/api/health` (M3); `/api/registry`, `/api/integrity`, `/api/portfolio/[address]` (M4) | Route handlers wrapping `packages/core`. zod-validated inputs. Rate-limited per IP. | |

> **As built (2026-10-02, owner revision):** the pages are Home `/`, Trade `/trade[/TICKER]`, Portfolio `/portfolio`, Radar `/radar` (this section's Trap Shield) and `/docs` (footer; holds the contract links). FAQ is a section of Home reached from the nav. `/api/radar` and `/api/portfolio` exist. The landing page lives on `trytally.xyz` and is built last; this app is `app.trytally.xyz`. UI copy uses "the guarantee" instead of "ShareGuard".

**Requirements:**
- Server components for static and SEO parts; client components for live data (react-query).
- Every live number uses beUI `number` with tabular figures.
- Mobile first. Done means the 375/768/1280 screenshots pass and the reduced-motion and keyboard checks pass (DESIGN §7).
- **Performance:**
  - Landing LCP < 2.5s on 4G;
  - JS for the landing route < 200 KB gzipped (lazy-load the trade flow and shader effects);
  - images via `next/image`.

---

## 12. Agent layer (Wallet Skills prize)
1. **`skills/share-true-trading/SKILL.md`** (binance-skills-hub format). It sits in front of `baw`:
   1. resolve the ticker through the Tally API (or MCP);
   2. choose the issuer by effective cost per share;
   3. convert shares ↔ USDT and enforce the 6 USDT minimum;
   4. build the ShareGuard calldata;
   5. execute with `baw contract-call preview` → show `parsedTx`, risks and the share minimum → `contract-call execute` after the user confirms. This requires **Developer Mode** in the Binance app.

   Also covers the USDT approval and receipt in shares, with confirmation rules mirroring the agentic-wallet skill (never silently change intent).
2. **MCP server (`packages/mcp`), tools:**
   - `get_consolidated_quote(ticker, usd | shares)`
   - `get_shares_of(address)`
   - `get_integrity(ticker?)`
   - `build_guarded_swap(ticker, usd, wallet, tolerance)` → `{approveTx?, swapTx, minShares, expiresAt}`

   All read-only or unsigned. Runs against the same backend.
3. **Upstream PR to `binance/binance-skills-hub`:** update `binance-tokenized-securities-info`:
   - it says Ondo is the only provider; document `type=2/3`;
   - add multiplier source-of-truth notes (V2);
   - add the gas caveat (V10);
   - the Ondo $5 minimum (V9).

   This is evidence for both the special prize and the DX report.
4. **Stretch:** an Agentic Wallet EIP-7702 batch (approve + swap + `assertMinShares`) if Agentic Wallet supports it.

---

## 13. Telegram bot v1 (`apps/bot`, read-only)
- **grammY,** long polling from the Seoul server (webhooks later, behind the domain). Uses the same backend API, never the Binance key directly.
- **Commands:**

| Command | Does |
|---|---|
| `/start` | Disclaimer + region declaration button (§9) + link to web |
| `/quote <TICKER> [usd]` | Issuer comparison in shares (top 2 + Trap flag), "Open in Tally" button (deep link) |
| `/price <TICKER>` | Share price, session, status per issuer |
| `/shares <0xaddress>` | Portfolio in shares (public data only) |
| `/shield [TICKER]` | Traps and integrity grades |
| `/alert <TICKER> gap > 0.3%` | Issuer gap alerts |
| `/alert <TICKER> paused` | Pause alerts |
| `/alerts`, `/stop`, `/help` | Manage alerts, stop, help |

- **Alerts** are evaluated every 60s with per-chat rate limits.
- **Formatting:** numbers in monospace, BscScan links, no images needed.
- **Later (P2):**
  - `/link` with a one-time code from the web portfolio, mapping Telegram ID to wallet address (public data only);
  - the Mini App for trading: the same web app inside Telegram's webview, signing in the user's own wallet.

---

## 14. Infrastructure and operations
- **Host:** AWS EC2 Seoul (KR), Ubuntu 24.04, 2 GB RAM, 30 GB disk.
  - Add a **4 GB swap file**. A Next.js build can run out of memory at 2 GB. Prefer building in CI and deploying the `output: "standalone"` bundle.
  - Processes: `systemd` units for `web`, `bot`, `mcp`.
- **Ingress:** **Cloudflare Tunnel** (`cloudflared`). No open inbound ports, HTTPS, and it provides the `cf-ipcountry` header.
  - Before the domain exists, a quick tunnel gives a temporary `*.trycloudflare.com` URL. It changes on restart, so update the wallet provider's allowed origins accordingly.
  - Once the domain is bought, move DNS to Cloudflare and use a named tunnel.
- **Secrets** in `/etc/tally/tally.env` (mode 600), loaded by systemd, never in git:
  - `BINANCE_W3_API_KEY`, `BINANCE_W3_API_SECRET`
  - `BSC_RPC_PRIMARY`, `BSC_RPC_FALLBACKS`
  - `PRIVY_APP_ID`, `PRIVY_APP_SECRET` (or Dynamic equivalents)
  - `TELEGRAM_BOT_TOKEN`
  - `FEED_SIGNER_PK`: the Ondo multiplier signer. User-created, low privilege, bounded by the contract.
  - `SHAREGUARD_ADDRESS`

  The **deployer/owner key is never on the server.**
- **Monitoring:**
  - `/api/health` checks Binance auth, the 40304 detector, RPC height and feed freshness;
  - an external uptime ping;
  - structured logs;
  - alert on any `40304` (region drift) or feed staleness.
- **Data:** SQLite at `/var/lib/tally/tally.db` (fills, alerts, Telegram links, registry snapshots), backed up daily.

---

## 15. Security model
| Threat | Mitigation |
|---|---|
| Arbitrary call through ShareGuard (spike bug) | Router and approve-target allow lists; fork test G |
| Over-broad approvals | Exact-amount approvals to ShareGuard only; the UI never asks for unlimited |
| Stale or manipulated quote | Re-quote before signing; `minShares` + `deadline` on-chain |
| Ondo feed signer compromise | Bounded step, monotonic, corporate actions only via the owner, signer rotation; worst case limited to that asset's `maxStepBps` |
| Phishing or cloned tokens | Addresses only from the registry |
| API key leak | Server-only; secrets file; never sent to clients; the key's permissions are limited to what the API grants |
| RPC outage or censorship | Failover transport; tx hash persisted before polling |
| Region-gate bypass | Edge block + declaration; documented residual risk |
| Front-end supply chain | Lockfile, pinned versions, CSP headers, no third-party scripts beyond the wallet provider |
| MEV on swaps | `enableMevProtection` exists only on Binance's `broadcast-transaction` endpoint (F10). Users sign and broadcast in their own wallet, so Tally cannot set it: protection is the share minimum + deadline, **not** a claimed MEV feature |
| Bot abuse | Read-only, rate limits, no keys |

---

## 16. Priorities
- **P0 (must ship):**
  - M0–M3: engine, ShareGuard v1 on mainnet with 2 guarded buys, web trade flow with Privy;
  - region gate;
  - README;
  - demo video;
  - the user's DX report.
- **P1:**
  - M4 portfolio in shares + Trap Shield;
  - M5 Wallet Skill + MCP + upstream PR;
  - M6 Telegram read-only bot;
  - $100 and $1,000 quote ladder in the README.
- **P2 (only if time remains):**
  - Onchain Pay top-up (needs a merchant code);
  - EIP-7702 one-signature flow;
  - Agentic Wallet batch;
  - Telegram linking and Mini App trading;
  - RFQ path;
  - shader backgrounds.

---

## 17. Milestones and exit checks
Today is Thu 1 Oct; submissions lock **Sun 11 Oct, 12:00 UTC**. Dates are targets; the exit checks are not negotiable.

| Milestone | Target | Scope | Exit check (all must pass) |
|---|---|---|---|
| **M0 Foundations** | Fri 2 Oct | Monorepo (§6), CI, `DESIGN.md` tokens + beUI install + base layout; Cloudflare quick tunnel on EC2; swap file; secrets file; region-gate middleware; **wallet-provider checks §8.1** | ① A landing skeleton is live on the tunnel URL with the design tokens. ② A US VPN visitor sees `/blocked`; a KR visitor sees the site. ③ A Privy embedded wallet sent a real BSC (chain 56) transaction from the app. ④ Provider AUP and restricted-country review written into §9. |
| **M1 Engine** | Sat 3 – Sun 4 Oct | `packages/binance` (recipe §7.1 + fixtures), `packages/chain` (failover, multipliers), `packages/core` (§7.2–7.5), CLI `tally quote NVDA 25`; confirm Market/Transaction/Wallet API paths; MEV parameter; read-only $100/$1,000 ladder | ① `tally quote NVDA 25` prints the per-issuer comparison (shares, $/share, premium, ≈fee, route, grade). ② Unit tests reproduce F1/F7 vectors (NFLX 10×, NVDAx 3-source mismatch, live fills). ③ 40304 and 40375 are handled from fixtures. |
| **M2 ShareGuard v1** | Sun 4 – Mon 5 Oct | §10 contract + tests; **user deploys** with their key; BscScan verification | ① All unit, fuzz and fork tests A–I pass. ② Verified on BscScan. ③ **Two live guarded buys** (NVDAB and NVDAon, 6 USDT each) through ShareGuard, with `Guarded` events. |
| **M3 Web trade flow** *(built; phone test pending)* | Tue 6 – Thu 8 Oct | Landing (§5.1 DESIGN), `/trade/[ticker]`, Privy sign-in, top-up tiers 1–2, trade plan §7.6, receipt in shares, error UX | ① Someone who has never used crypto buys $6 of NVDA in shares on a phone, end to end, without help. ② Playwright passes at 375/768/1280. ③ Reduced motion and keyboard paths pass. |
| **M4 Portfolio + Trap Shield** | Thu 8 Oct | `/portfolio`, `/shield`, integrity everywhere | The portfolio shows the test wallet's NVDAB + NVDAon in shares, with correct multipliers; Shield lists NFLX, ghost xStocks and disagreements. |
| **M5 Agent layer** | Fri 9 Oct | Skill, MCP, upstream PR | In Claude Code: "buy half a share of Apple, cheapest issuer" goes through preview, then execute via `baw`, through ShareGuard. PR opened upstream. |
| **M6 Telegram v1** | Fri 9 Oct | §13 read-only | `/quote NVDA 25` and `/shield` answer in under 3s; an alert fires in a test. |
| **M7 Submission** | Sat 10 – Sun 11 Oct (code freeze Sat 23:59 UTC) | README (what, how to run, architecture, evidence links), demo video, deployed link, submission form, the user's DX report | Every item in §18 is checked; links work from a fresh browser outside the team's region. |

---

## 18. Submission checklist
- [ ] The repo is public, `main` is up to date, the README explains how to run it and links `DESIGN.md`, this blueprint and the evidence.
- [ ] Deployed link works (and stays up through 23 Oct). The region gate allows judges outside the blocked list.
- [ ] Demo video ≤ 4 minutes (script below), uploaded, linked.
- [ ] ShareGuard verified on BscScan; links to the guarded live buys.
- [ ] Developer Experience Report, **written by the user**, submitted via the form. Use `IDEAS.md` §F1–F9 and the DX leads list as the evidence index.
- [ ] Submission form filled before **Sun 11 Oct 12:00 UTC**.

**Demo script (≤ 4 min):**

| Time | Beat |
|---|---|
| 0:00 | "Is one NFLX token one Netflix share?" Ondo 10 vs bStock 1. A naive tool shows +869%. |
| 0:40 | Trade page: three issuers quoted in shares. "Best" re-sorts live; xStocks flagged as a ghost market. |
| 1:30 | Sign in with email (embedded wallet on BSC), top up via deposit, buy $6 of NVDA. Dynamic-island progress. Receipt in shares with the BscScan link. |
| 2:30 | ShareGuard: show a simulated revert when the shares fall short. "Guaranteed in shares, on-chain." |
| 3:00 | Agent: Claude Code + the Wallet Skill buys through ShareGuard. Telegram `/quote`. |
| 3:40 | Portfolio in shares, dividends as shares. Close with the upstream PR and the DX findings. |

---

## 19. Owned by the user (the build session must not do these)
- Create the **ShareGuard deployer/owner key** and the **Ondo feed-signer key**. Fund the deployer with a little BNB (≈0.0005; the dry run estimates 0.0003). Run the deploy script on their own machine (`contracts/README.md`). The build session needs only the feed signer's **address**, a **BscScan API key** for verification, and an archive BSC RPC for fork tests.
- Buy the **domain** and add it to Cloudflare. Create the **Privy** (and/or Dynamic) app and add the allowed origins. Create the **Telegram bot** via BotFather. Get a **dedicated BSC RPC** key.
- Keep the **Binance Web3 API key** in the server secrets file. Ask in the builder Telegram for **elevated rate limits** and about an **Onchain Pay merchant code**.
- Do the human test in M3 (or recruit a non-crypto friend). Record the demo video.
- **Write the Developer Experience Report** (human-written; AI-generated reports are rejected).

---

## 20. Open questions (resolve in the milestone shown)
| Question | Where |
|---|---|
| Privy vs Dynamic final choice; BSC embedded wallet; AUP | M0 |
| Exact Market / Transaction / Wallet API paths and the MEV-protection parameter | M1: **resolved**: paths probed on the Seoul EC2, `enableMevProtection` found (broadcast only); Market `price`/`candlestick` need another source |
| Trading API rate limits | M1: ~5 calls then 42900 observed; elevated limits requested, not yet granted |
| Does bStock's token implementation expose a pause getter? | M2: **resolved: no.** Its transfer asks a shared manager `0x9fc7…700a` `isTokenPaused(token)`; ShareGuard stores that address per asset (IDEAS §F11) |
| Feed parameters: per-asset `maxStepBps` (start 300 bps), `maxAge` | M2: **built** (300 bps start, cap 1000; `maxAge` 3 days, settable 1 h–7 d) |
| Is bStock's pause manager ever rotated? It is not discoverable from the token | open; owner updates the asset via `setAsset` |
| Default tolerance: 1% (the live fill came in 0.51% under quote, so 0.5% would have failed) | M3 user test |
| Can Cloudflare on our plan see Crimea, Donetsk and Luhansk sub-regions? | M0 |
| Onchain Pay merchant access | ask Binance; P2 |
| Does Agentic Wallet support 7702 batches? | M5 (stretch) |

---

## 21. Risks
| Risk | Impact | Mitigation |
|---|---|---|
| Binance changes routing (e.g. Ondo becomes RFQ) | Ondo buys fail | Detect `executionMode`; fall back to bStock; RFQ path is P2 |
| Wallet provider fails the AUP or BSC checks | Onboarding | Dynamic fallback; external wallets always work |
| Seoul gets blocked (40304) | All quotes down | Health check alert; second region ready (e.g. Singapore). Rerun `research/region_check.py` there first. |
| 2 GB server limits | Builds fail | Swap file; build in CI |
| Time | Scope | P0/P1/P2 tiers; P0 first |
| ShareGuard bug | Funds at risk | Allow lists, tests A–I, tiny live amounts only, no funds held between transactions, pause switch |

---

## Appendix A: first prompt for the new build session
> "We're building **Tally** for the BNB Hack: Tokenized Stocks Edition. Read `TALLY_BLUEPRINT.md` end to end, then `DESIGN.md`, then `IDEAS.md` §Findings F1–F9. The decisions in blueprint §4 are final unless new evidence contradicts them. Start **M0** (§17). Before writing code, list the M0 tasks you'll do and the exit checks, and ask me for anything only I can provide (§19). Use the BeUI MCP for components and follow `DESIGN.md` exactly. Never create or handle private keys. Work on a new branch and open a PR per milestone."

## Appendix B: constants (BSC mainnet, chain 56)
| Name | Value |
|---|---|
| USDT (18 decimals) | `0x55d398326f99059fF775485246999027B3197955` |
| Trading API router = approve target (LiquidMesh) | `0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5` |
| NVDAB (bStock) | `0x02fca66c1d1afb4e2a7884261eb00f63598a7436` |
| NVDAon (Ondo) | `0xa9ee28c80f960b889dfbd1902055218cba016f75` |
| NVDAx (xStocks, data only) | `0xc845b2894dbddd03858fd2d643b4ef725fe0849d` |
| AAPLB / AAPLon | `0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a` / `0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4` |
| TSLAB / QQQB / SPYB | `0x5b1910eaad6450e50f816082aa078c41f10c292f` / `0x205812cdbed920aff76c6580abd681a46d11efc7` / `0x7138b48df7d98d7e3cc221bfe7192d0a178182d8` |
| Ondo `compliance()` (NVDAon) | `0x76be569c94c39a2e2492de2f4d1c253f348250d0` → `0x62fbbe0312d31823579de46ab1d89fae0b798e61` |
| Ondo `tokenPauseManager()` | `0x6334924c787ebd21c881740ef6237ef51962638f` (`isTokenPaused(address)`) |
| bStock `compliance()` (NVDAB) | `0x53dba7aabde774787a1f57236b235567da8e14f4` |
| bStock pause manager (shared by all bStocks seen) | `0x9fc74Be63f3589485B2423984a7a0557e0CF700a` (`isTokenPaused(address)` `0x5e76ad54`) |
| Selectors | `uiMultiplier()` `0xa60bf13d` · `multiplier()` `0x1b3ed722` · `compliance()` `0x6290865d` · `tokenPauseManager()` `0x461ad792` |
| **ShareGuard v1 (deployed 2026-10-02)** | `0x28F6F19bffbF25E36452c78d12090F0bC922970a` (owner: the user's deployer wallet; feed signer `0xDd3C5F463d71fb06D7bE749F904A4090E080f407`) |
| Revert seen with too little gas | `0x1425ea42` = `FailedInnerCall()` |
| Spike burner (test fills) | `0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930` |

Re-read token addresses from the registry at runtime; this table is for tests and docs.

## Appendix C: evidence index
| Topic | Where |
|---|---|
| Winner analysis | `IDEAS.md` §1, `research/analyze_winners.py` |
| Market snapshot | `research/snapshot-2026-09-30/`, `research/analyze_snapshot.py` |
| Compliance and transfers | `research/transfer_check.py`, `IDEAS.md` §F2 |
| Region enforcement | `research/region_check.py`, `spike/region_report_ec2-seoul.json`, `IDEAS.md` §F3 |
| Routes, fees, gas | `IDEAS.md` §F4, `spike/results/capture_*.json` |
| Fork tests | `spike/shareguard/`, `spike/results/fork_*.log`, `IDEAS.md` §F5; ShareGuard v1: `contracts/`, `IDEAS.md` §F11 |
| Live buys | `spike/results/live_*.json`, BscScan links in `IDEAS.md` §F6 |
| Design source | `spike/revenue-family-landing-page.png`, revenue.family `assets/site.css?v=42`, `DESIGN.md` |
