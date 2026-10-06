# Tally modules (v2)

Supersedes the 2026-10-02 version (Receipts, Switch, Rewards → Stocks), archived at `docs/archive/MODULES-v1.md`. Those three modules are carried over below, unchanged in substance, alongside the new ones.

| | |
|---|---|
| Written | 2026-10-03, after M2 (ShareGuard v1 at `0x28F6F19bffbF25E36452c78d12090F0bC922970a`), before M3 |
| Evidence | `spike/results/module_probes_20261003T121018Z.json` … `…T130122Z.json` (read-only API + RPC probes from the team's PC in Nigeria) |
| Delivery | Parallel AI-agent team, one branch per work order. See `AGENTS.md` and `docs/work-orders/`. |
| Rule | **No module may regress the buy flow, Portfolio or Radar.** Every module is behind a feature flag and fails on its own (§3). |

---

## 1. Positioning change

The quote comparison ("best price across issuers") is now an **internal library**, not the product's front page. Several hackathon teams ship routers and quote guards (Orchard, OneTicker, Executable Gap Desk, yostocks). Tally's moat is **share-true data**: every module below is correct in *shares* across issuers whose tokens represent different amounts of stock (Ondo NFLX = 10 shares/token, bStock NFLX = 1). Nobody else's flow tape, basket, statement or alert is.

Pitch line: **Buy in shares → Prove every fill → Watch over what you hold → See who's moving the market → Build a portfolio that rebalances itself.**

What stays: the engine (`@tally/engine`), ShareGuard v1, the integrity grade, the region gate, the minimums.
What changes: the landing page leads with Portfolio, Radar and Guardian; "Trade" is one action among several.
What's dropped: the stand-alone read-only Telegram bot (M6) as its own milestone (its channel becomes Guardian's), the EIP-7702 stretch, card on-ramp.

---

## 2. Module catalogue and build order (cheapest first)

The order is the cut line: if time runs out, everything above the cut ships and everything below goes to the README roadmap, flag-off.

| # | Module | Surface | Work order | Est. | Depends on |
|---|---|---|---|---|---|
| 0 | **Foundation** (snapshot store, collector, flags, health, module boundary) | none (infra) | WO-00 | ½–1 d | — |
| — | **M3 trade flow** (blueprint §17, unchanged) | Trade | WO-01 | 2–3 d | WO-00 flags only |
| 1 | **Receipts + Execution quality report** | Trade result, Portfolio → Activity, `/quality` | WO-02 | 1–1½ d | M3 plan/simulate (pure part starts now on F6 vectors) |
| 2 | **Statement** (holdings in shares, average cost per share, realized P&L) | Portfolio → Statement | WO-03 | 1 d | WO-00 |
| 3 | **Flow in the Radar** (+ Radar page itself) | Radar | WO-04 | 1½ d | WO-00 |
| 4 | **Guardian alerts** | Telegram + web feed | WO-06 | 1 d | WO-00, WO-04 snapshots |
| 5 | **Sell + Switch issuer** | Portfolio row actions | WO-07 | 1½–2 d | M3, gates V-B1…V-B4 |
| 6 | **Guardian autopilot** (Agentic Wallet, caps, kill switch, decision log) | Guardian settings | WO-08 | 1–1½ d | WO-06, WO-02, `baw` check |
| 7 | **Pies** (fixed templates, drift rebalance) | Pies | WO-09 | 1½–2 d | M3, WO-07 sell path |
| 6b | **Agent layer** (MCP server, Wallet Skill, upstream PR; blueprint M5) | Claude Code / Cursor / Agent Studio | WO-05 | 1 d | engine (done), ShareGuard (done) |
| 8 | **Rewards → Stocks + idle-cash yield** | Portfolio → DeFi card | WO-10 | 1 d | WO-02, gates V-C1…V-C3 |
| — | **UI** (all pages, built from each module's view model) | all | WO-12 | continuous | each module's view model |
| 9 | Venus collateral guard (NVDAB is a Venus market) | Guardian rule | roadmap | — | WO-06 |

**Cut line:** a module not merged by **Thu 8 Oct 23:59 UTC** ships flag-off and is listed as roadmap. Code freeze Sat 10 Oct 23:59 UTC. Submission Sun 11 Oct before 12:00 UTC.

---

## 3. Architecture: modular, redundant, fail-alone

```
            Binance Web3 API ─┐        ┌─ NodeReal RPC (primary chain + logs)
                              ▼        ▼  Ankr RPC (second), public RPC (reads only)
                       apps/worker  collector  (the ONLY process that calls external sources on a schedule)
                              │  writes timestamped snapshots, each with source + observedAt + notes
                              ▼
                     SQLite  $TALLY_DATA_DIR/tally.db   (node:sqlite, no native deps)
            ┌─────────────┬─────────────┬─────────────┬─────────────┐
            ▼             ▼             ▼             ▼             ▼
       mod-flow     mod-guardian   mod-statement  mod-receipts   mod-pies …   (pure logic packages + one loop each in apps/worker)
            └─────────────┴──────┬──────┴─────────────┴─────────────┘
                                 ▼
               apps/web (one <ModuleBoundary> card per module) · apps/bot (Guardian channel) · packages/mcp
```

**Rules every module follows**

1. **Reads snapshots, never the network, on the hot path.** Only the collector (and the trade plan, which must quote live) calls Binance or RPC.
2. **Every source has a fallback and every fallback warns.** `onWarn` / integrity-log style: a missing fact carries its reason; nothing fails silently (CLAUDE.md).
3. **Staleness is explicit.** `latest(kind, key, { maxAgeMs })` returns `{ data, observedAt, ageMs, stale, source }`. Stale data is shown with its age, never as live.
4. **Own process, own health row.** Each module's worker loop runs as its own process (`pnpm worker flow`, `pnpm worker guardian` …) and writes `module_health(module, ok, lastRunAt, lastError)`. A crash restarts that loop only.
5. **Own UI boundary.** Each card is wrapped in `<ModuleBoundary module="flow">`: React error boundary + health check + flag check. A failing module renders one degraded card ("Flow is catching up, last update 4 min ago"), never a broken page.
6. **Feature flag, default off.** `FEATURE_<MODULE>` in `packages/config/src/flags.ts` (created once in WO-00 for every module, so no later PR touches it). A flag turns on only after the module's exit checks pass and both reviews approve.
7. **Pure core, thin shell.** Business logic lives in `packages/mod-<name>` as pure functions over typed inputs, tested against recorded fixtures. Web, bot, worker and MCP only wire it.
7b. **View model is the UI contract.** Each module exposes a typed view model in `apps/web/modules/<name>/view-model.ts` (with stale, empty and error states). One UI agent (WO-12) builds every page from those view models, so the product looks like one product.
8. **No new dependencies** without orchestrator approval (lockfile conflicts across parallel branches). WO-00 adds the expected ones up front.

**Data sources confirmed on 2026-10-03** (full responses in the probe files):

| Need | Primary | Fallback | Notes |
|---|---|---|---|
| Trades per token | `GET /market/trades` (cursor, 100/page) | NodeReal `eth_getLogs` Transfer (10,000 blocks ≈ 75 min per call, 3 s) | Public RPC refuses `eth_getLogs` at any range; QuickNode returns 413 |
| Holders, top traders | `GET /market/token/holder`, `/token/top-trader` | — (show "unavailable", reason) | Includes `fundingSourceLabel` (e.g. CEX wallet) |
| Candles | `GET /market/candles` (`bar` lower-case: `1h`, `1d`) | — | NVDAB 114 days, NVDAon 284 days of 1d history |
| Prices | `GET /market/rwa/price?tokenContractAddresses=a,b` (batch) | public RWA dynamic | `POST /market/price` and `/price-info` return 50000 for stock tokens |
| Status / session | `rwa/tokens` + `rwa/underlying-market` `statusInfo` | — | Ondo only. **bStock `marketStatus` is always `null`** → pause from on-chain pause manager (as ShareGuard does) |
| Wallet P&L | `portfolio/overview` (`timeFrame` 1–4), `recent-pnl`, `token/latest-pnl`, `dex-history` | Receipts + logs | Token units; Tally converts to shares |
| DeFi | `POST /defi/data/investment/list` (`investType` required), `position/list` (`addresses[]`) | — | 58 Earn products on BSC; NVDAB has a Venus market and PancakeSwap V3 pools |
| Leaderboard / tracker | `leaderboard/list` (`timeFrame`, `sortBy`), `address-tracker/trades` (`trackerType` 1/2/3) | — | Mostly memecoin wallets; filter by our registry |

---

## 4. Modules

Each section: job · data · how it fails safely · exit checks. Work orders carry the full task lists.

### 4.0 Foundation (WO-00)

`packages/modkit`: `SnapshotStore` (node:sqlite), `ModuleHealth`, `flags`, `withFallback(primary, fallback, onWarn)`, `stale()` helpers, shared types. `apps/worker`: collector jobs + per-module loop runner. `apps/web`: `<ModuleBoundary>`, `/api/modules/health`, nav entries behind flags. Also: map Ondo's undocumented `marketStatus: "offhours"` in `packages/core/src/status.ts` (observed 2026-10-03; today it falls to `unknown`).

Exit: a module that throws on every run shows one degraded card while the rest of the page works (Playwright test); killing one worker process leaves the others' `module_health` fresh; all existing tests green.

### 4.1 Receipts + Execution quality (WO-02)

*Carried over from v1 §4 (Receipts / "Trace").* Job: *"Did I receive what Tally said I'd receive?"* for every guarded operation, with evidence.

Captured per stage in `packages/mod-receipts`: intent (asset, issuer, spend, min shares, tolerance, approvedAt) → quote (quoteId, expected out, route, observedAt, expiresAt) → simulation (`POST /pre-transaction/simulate` + `eth_call` at the exact limit) → conversion (multiplier value, source, observationId, observedAt) → realized (txHash, block, status, ShareGuard `Guarded` event, Transfer logs of this tx only).

Reconciliation is deterministic: `RECONCILED` (within 0.01% of simulation) · `RECONCILED_WITH_DIFFERENCE` (≠ simulation, ≥ signed minimum) · `PENDING` · `FAILED` (decode `InsufficientShares`, `TokenPaused`, `FailedInnerCall` …) · `UNRECONCILED` (wrong asset or unexplained amount). Raw token units are authoritative; shares are derived and labelled with their observation. A receipt never changes when the multiplier changes later.

**Execution quality report (new, Rule 605 style)**: a public `/quality` page aggregating receipts: fills, fill rate, median and p90 difference vs quote, vs simulation and vs the US reference price per share, by issuer and by route length. Pure aggregation over receipts; shows "not enough fills yet (n < 5)" honestly.

Test vectors on record (F6): NVDAB buy −0.51% vs quote → `RECONCILED_WITH_DIFFERENCE`; NVDAon +0.01% → `RECONCILED`; out-of-gas NVDAon → `FAILED`. Edge tests: wrong decimals, later multiplier change, missing transfer evidence.

Fails safely: if RPC is down, receipts stay `PENDING` with the hash; the quality page excludes pending ones and says how many.

### 4.2 Statement (WO-03)

Broker-style statement: holdings **in shares** across issuers, average cost per share, realized P&L, trade history; monthly export (PDF/CSV). Sources: `portfolio/token/latest-pnl`, `recent-pnl`, `dex-history`, `overview` (needs `timeFrame`), plus Tally's own receipts. All API figures are per token and are converted with the multiplier observed at each trade (from receipts) or flagged "converted at today's ratio" when no observation exists.

Fails safely: if the API P&L disagrees with receipts by > 1%, show receipts and a "differs from Binance's figure" note; if the API is down, show receipts only.

### 4.3 Flow in the Radar (WO-04)

The Radar page (Trap Shield, blueprint M4) gains a flow panel per ticker:

- **Net flow in shares** by issuer (1h / 24h / 7d), buys vs sells, last real trade age.
- **Cleaning** (mandatory, probes showed why): count only legs whose counterpart is USDT/USDC/USD1/USDon (the first NVDAB trade sampled was against a memecoin at `price 4778237`); recompute price from amounts; label **bots** (high turnover, near-zero holdings: the top NVDAB trader made $17k realized holding ~0); label **custody** (top holder with 48% of NVDAB, funded by a Binance CEX wallet) and exclude it from concentration stats.
- **Holder concentration** (top-10 % excluding custody) and **whale prints** (single trades ≥ $10k).
- **Feeds the integrity grade**: no real trade in N days or < $1,000 24h real volume = ghost (extends the M1 rule with cleaned volume).

Fails safely: API down → NodeReal Transfer logs (classified with the same rules, marked "from chain logs"); both down → last snapshot with its age.

### 4.4 Guardian alerts (WO-06)

Watches what the user holds and tells them, in plain words, on Telegram and in a web feed. Facts only, never advice.

| Rule | Input | Alert |
|---|---|---|
| Paused / halted | Ondo `statusInfo`; bStock on-chain pause manager | "NVDA via Ondo is paused: session transition. Your shares are unchanged." |
| Share count changed | multiplier observations (Ondo bounds, bStock `uiMultiplier`) | "Your token count is the same; your shares rose 0.6% (dividend reinvested)." |
| Integrity grade dropped | Radar snapshots | "TSLA via bStock dropped B → D: no real trade for 3 days." |
| Ghost / no exit | Flow | "There's no market to sell this token on BNB Chain right now." |
| Price threshold (per share) | reference price | user-set level, regular session only |
| Earnings | **external calendar** (the API's `tabId=3` is ignored) | cut if no reliable source by Wed |

De-duplication and quiet hours; every alert links to the evidence (snapshot id). Telegram via `apps/bot` (grammY). Fails safely: Telegram down → web feed still updates; a rule that errors is skipped and logged, others run.

### 4.5 Sell + Switch issuer (WO-07)

*Carried over from v1 §5 unchanged.* Sell: Portfolio row → quote stock → USDT (`userWalletAddress` = user) → simulate → user signs the API transaction directly; the router's `minReceiveAmount` enforces the floor; Receipts checks it. Switch: one route through the **deployed** ShareGuard (`tokenIn` = source stock, `stock` = destination, floor in destination shares), atomic; two-leg switches only via a separate v1.1 contract or 7702 batch, otherwise not shipped. No "switch now" recommendations; xStocks as source → "No market to exit this token on BNB Chain". Gates V-B1…V-B4 (`docs/archive/MODULES-v1.md` §7) must pass first; fork tests J (switch succeeds) and K (floor too high reverts).

### 4.6 Guardian autopilot (WO-08)

Opt-in, Agentic Wallet users only. Allowed actions: sell to USDT, or switch issuer, when a rule the user armed fires (pause lasting > X h, grade ≤ D, per-share stop level in regular session). Hard limits: per-trade cap, daily cap, allow-listed tokens, kill switch, every decision written to an append-only decision log (inputs, rule, action, receipt id). Execution through `baw` → ShareGuard (switch) or the API transaction (sell), then Receipts. Fails safely: any check fails, `baw` unavailable, or a cap reached → downgrade to an alert; never retries a failed trade automatically.

Pre-check (orchestrator + user, Sun): does `baw` support contract calls with spend limits / session policies on BSC? If not, autopilot = "one-tap approve from the alert", and this is stated plainly.

### 4.7 Pies (WO-09)

M1-Finance-style baskets that stay in the user's own wallet (no pooled vault: RFQ signing and fund-law reasons). Templates are **fixed lists in the repo** (`tabId` sector filters are ignored by the API): Mag 7, AI Chips, a "Berkshire 13F" pie (top holdings from the latest 13F, mapped to available tokens, with the filing date shown). Weights are **in dollars of shares**, computed with each issuer's multiplier. Rebalance when drift > threshold: sells first (Sell path), then guarded buys; each leg a receipt; minimum order 6 USDT per leg enforced (small pies rebalance less often; the UI says so).

Fails safely: a leg that fails leaves the pie "partially rebalanced" with the exact state shown; no retries without the user.

### 4.8 Rewards → Stocks + idle-cash yield (WO-10)

*Carried over from v1 §6 (manual version only).* Claim realized rewards (`REWARD_PROTOCOL`, `REWARD_INVESTMENT`, `LP_FEE`; `REDEMPTION` hard-blocked), simulate and require principal unchanged, buy the stock with exactly the claimed amount (from the claim tx's Transfer logs). New: the DeFi API lists 8 USDT Earn products on BSC (Plume 10.82%, Lista, Venus …) and NVDAB pools (PancakeSwap V3 NVDAB-USDT, 155% APR on $374k at probe time), so a demo is fundable. Gates V-C1…V-C3 (`docs/archive/MODULES-v1.md` §7). Automation stays post-hackathon.

---

## 5. Viability gates still open

| Gate | Module | Who / how | Pass if |
|---|---|---|---|
| V-B1, V-B2 | Sell, Switch | user, `research/module_viability.py` on PC or EC2, pre-market **and** regular hours (Mon) | direct stock→stock and stock→USDT quotes return `SWAP`, cost < 0.5% at $7. **Result 2026-10-05 (pre-market, PC 09:09 UTC and EC2 10:08 UTC): V-B1 FAIL (`40368`: Ondo can only pair with stablecoins, so Switch is cut); V-B2 PASS on the EC2** (`research/results/module_viability_20261005T090942Z.json`, `…T100837Z.json`). Regular-hours re-run of V-B2 still wanted. |
| V-B3 | Switch | WO-07 fork tests J, K | floor holds; too-high floor reverts atomically |
| V-B4 | Sell, Switch | user, one live $6 each | both reconcile |
| V-AW | Autopilot | user + orchestrator, `baw --help`, `baw` policy docs | spend caps or session policy exist on BSC. **Result 2026-10-06: PROVISIONAL (documentation only; the live money test is still required before WO-08 implementation).** `baw` 1.10.0, 149 help outputs read, nothing run against a wallet (`docs/evidence/V-AW-baw-policy.md`). Yes: API-enforced daily quotas (separate pools: trading, Developer Mode external calls, DeFi, prediction, x402), session expiry, token whitelist, action-category toggles, conditional direct broadcast (`requireConfirmation=false`), BSC supported, refusal on a breached daily limit. No: a per-trade cap, a per-rule budget, a sell-to-USDT-only policy or a contract/function allow-list; settings cannot be changed from the CLI (Binance App only). Documentation evidence only, not a live enforcement test. **Live read of the chief engineer's wallet (2026-10-06):** Developer Mode on, `requireConfirmation=false` on a preview (direct broadcast available), whitelist active (`tradeAllTokens=false`). **Binance App minimum daily limits: DEX trading $1,000, DeFi $5,000, prediction $5,000, Developer Mode $1,000, x402 $20.** So a cap-refusal cannot be tested with small money, and the wallet's own cap is not a tight rail for a small account: Tally's per-trade and daily caps must be enforced in our own `decide`, and the README must not call the wallet cap a safety guarantee. Remaining live test: one unattended $6 sell (`live-sell-test.sh … sell`). |
| V-C1…C3 | Rewards | user, `baw defi …` + DeFi API | claimable reward ≥ $6 reachable, principal unchanged in simulation, route reward → stock exists |
| V-E | Guardian earnings rule | orchestrator | a free, reliable earnings-date source exists; else the rule is cut |

---

## 6. Raw notes for the Developer Experience Report

The report is written by the user (AI-written reports are rejected). These are evidence pointers only; file and key names refer to the probe files above.

- `rwa/tokens?tabId=…` ignores `tabId`: tabs 3, 4, 9, 11, 13 return the same 488 tokens (`P_tab_*`, `G_rwa_tokens_earnings`).
- `POST /market/price` and `/market/price-info` return `50000 Internal server error` for every stock token tried (`F_price_*`, `F_price_info_*`), while `rwa/price` works.
- `marketStatus: "offhours"` (Ondo, Saturday) is not in the documented enum (`G_underlying_market_NVDAon`).
- bStock `statusInfo.marketStatus` is always `null`, `nextOpenTime` null (`G_underlying_market_NVDAB`, 92/92 in the 10-02 list).
- bStock `protections.collateralReport.supported: true` with `url: null` (`G_underlying_profile_NVDAB`).
- `trades[].price` is meaningless when the counterpart isn't a dollar stablecoin (NVDAB vs JARVIS: `4778237`) (`F_trades_NVDAB`).
- `top-trader` AAPLB entry with `avgSellPrice 20742` for a ~$335 stock (`F_top_trader_AAPLB`).
- `portfolio/overview` error says "timeFrame is required" when `walletAddress` was sent, then "walletAddress is required" when `address` was sent: the two errors arrive one at a time (`X_portfolio_overview*`).
- `defi/data/investment/list` answers a generic `Parameter error` when `investType` is missing instead of naming it (`R_investment_list*`); `position/list` the same for `addresses`.
- `transactions-by-address` returns `Parameter error` for every combination tried (`X_tx_by_address`).
- The leaderboard and address tracker reveal required parameters one per call (`timeFrame` → `sortBy`).
- Public BSC RPC (`bsc-dataseed`) refuses `eth_getLogs` at any range, 5 blocks included (`F_logs.providers.public_dataseed`).
- `aggregator/quote` between two stock tokens (bStock ↔ Ondo) returns `40368 "Ondo asset on chain 56 can only pair with allowed stablecoin(s); got: <token address>"` on every pair tried (`research/results/module_viability_20261005T090942Z.json`, `…T100837Z.json`, key `switch`); sells to USDT quote and build normally.
- The viability script run on the PC returned `40001 "Parameter [userWalletAddress] error"` for every sell build because it was started with `--guard 6` (a wrong argument); the EC2 run, with the ShareGuard address, built all four.
