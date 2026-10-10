# Recorded Evidence and Fixtures Index

This document provides a factual index of every recorded fixture and probe file in `packages/binance/fixtures/raw/` and `spike/results/`.
All dates, payloads, and parameter details are copied directly from file contents and file headers with zero interpretation.

---

## 1. Raw Binance API Fixtures (`packages/binance/fixtures/raw/`)

These fixtures were recorded against the Binance Web3 / DEX Aggregator APIs (primarily from the AWS Seoul EC2 instance in South Korea, or from specific country egress IPs for compliance checks).

| File | Date Recorded (UTC) | Size | What Was Recorded | Consuming Work Orders & Modules |
|---|---|---|---|---|
| `packages/binance/fixtures/raw/error_cases_20261002T024847Z.json` | 2026-10-02T02:48:47Z | 1,282 B | Recorded API error responses: below-minimum order (`40375`, 5 USD limit on Ondo), missing user wallet (`40001`), and bad credentials (`40101`). | WO-00, M1 (`packages/binance`) |
| `packages/binance/fixtures/raw/health_supported_chain_20261002T024847Z.json` | 2026-10-02T02:48:47Z | 352 B | Response from `GET /api/v1/dex/aggregator/supported/chain` confirming supported chain IDs (including BSC chain `56`). | WO-00, M1 (`packages/binance`) |
| `packages/binance/fixtures/raw/probes_20261002T052602Z.json` | 2026-10-02T05:26:02Z | 3,864,858 B | Broad RWA endpoint probes: `rwa/tokens` (paging parameters, limit/offset, tabId, platformId filter for xstocks/bstock), `rwa/price`, `rwa/underlying-profile`, `rwa/underlying-market`, and `market/price`. | WO-00, WO-06, M1 (`packages/binance`, `packages/engine`) |
| `packages/binance/fixtures/raw/quote_bnb_price_20261002T024847Z.json` | 2026-10-02T02:48:47Z | 5,475 B | Response from `GET /api/v1/dex/aggregator/quote` swapping USDT to WBNB on BSC, used for determining BNB/USD gas price. | M1 (`packages/binance`, `packages/engine`) |
| `packages/binance/fixtures/raw/quote_ladder_20261002T024847Z.json` | 2026-10-02T02:48:47Z | 69,620 B | 24 recorded quote responses across 3 tickers (`NVDA`, `AAPL`, `NFLX`) and 2 issuers (`Ondo`, `bStock`) across ladder tiers 6, 25, 100, and 1000 USDT. | WO-01, WO-05, M1 (`packages/binance`, `packages/engine`), `apps/web` offline replay |
| `packages/binance/fixtures/raw/rate_limit_probe_20261002T024847Z.json` | 2026-10-02T02:48:47Z | 2,809 B | Rapid burst of 30 requests to measure API pacing; recorded first failure at index 6 with HTTP 429 (`42900 Too many requests`). | M1 (`packages/binance`) |
| `packages/binance/fixtures/raw/region_block_CA_20261002T032617Z.json` | 2026-10-02T03:26:17.565906+00:00 | 364 B | Egress check from Canada (CA): HTTP 200 with JSON payload `40304` ("Service not available due to compliance restriction"). | WO-00, M1 (`packages/binance`, `packages/config`) |
| `packages/binance/fixtures/raw/region_block_JP_20261002T033902Z.json` | 2026-10-02T03:39:02.363251+00:00 | 245 B | Egress check from Japan (JP): HTTP 200 with successful response (`ok: true`, note that Japan was not blocked by API). | WO-00, M1 (`packages/binance`, `packages/config`) |
| `packages/binance/fixtures/raw/region_block_NL_20261002T032307Z.json` | 2026-10-02T03:23:07.754784+00:00 | 349 B | Egress check from Netherlands (NL): HTTP 200 with JSON payload `40304` ("Service not available due to compliance restriction"). | WO-00, M1 (`packages/binance`, `packages/config`) |
| `packages/binance/fixtures/raw/region_block_RO_20261002T032153Z.json` | 2026-10-02T03:21:53.681374+00:00 | 349 B | Egress check from Romania (RO): HTTP 200 with JSON payload `40304` ("Service not available due to compliance restriction"). | WO-00, M1 (`packages/binance`, `packages/config`) |
| `packages/binance/fixtures/raw/region_block_US_20261002T034006Z.json` | 2026-10-02T03:40:06.860607+00:00 | 349 B | Egress check from United States (US): HTTP 200 with JSON payload `40304` ("Service not available due to compliance restriction"). | WO-00, M1 (`packages/binance`, `packages/config`) |
| `packages/binance/fixtures/raw/rwa_authenticated_probes_20261002T024847Z.json` | 2026-10-02T02:48:47Z | 478,916 B | Authenticated RWA API queries for `rwa/tokens` (488 tokens returned across Ondo and bStock), `rwa/price`, `rwa/search`, `rwa/underlying-profile`, `rwa/underlying-market`, and `rwa/platforms`. | WO-00, WO-06, M1 (`packages/binance`, `packages/engine`) |
| `packages/binance/fixtures/raw/swap_build_20261002T024847Z.json` | 2026-10-02T02:48:47Z | 20,343 B | Swap build transactions from `POST /api/v1/dex/aggregator/swap` for NVDAon and NVDAB for a 6 USDT buy. | WO-01, M1 (`packages/binance`, `packages/engine`) |

---

## 2. Spike Results (`spike/results/`)

These files record fork test captures, Foundry execution logs, live mainnet transaction receipts, comprehensive module viability probes, reconciliation vectors, and node transfer logs.

| File | Date Recorded (UTC) | Size | What Was Recorded | Consuming Work Orders & Modules |
|---|---|---|---|---|
| `spike/results/capture_NVDAB_20261001T123316Z.json` | 2026-10-01T12:33:48Z | 8,243 B | Route capture for NVDAB at BSC block 125101230; multiplier `1000778223752807865`, amountIn `6000000000000000000` (6 USDT), with quotes and swap calldata. | M2 (ShareGuard fork tests), WO-02, `contracts` |
| `spike/results/capture_NVDAB_20261001T124535Z.json` | 2026-10-01T12:45:39Z | 11,750 B | Route capture for NVDAB at BSC block 125102807; multiplier `1000778223752807865`, amountIn `6000000000000000000`, with quotes and swap calldata. | M2 (ShareGuard fork tests), WO-02, `contracts` |
| `spike/results/capture_NVDAB_20261001T134525Z.json` | 2026-10-01T13:45:26Z | 16,416 B | Route capture for NVDAB at BSC block 125110774; multiplier `1000778223752807865`, amountIn `6000000000000000000`, with quotes and swap calldata. | M2 (ShareGuard fork tests), WO-02, `contracts` |
| `spike/results/capture_NVDAB_20261001T142131Z.json` | 2026-10-01T14:21:32Z | 8,248 B | Route capture for NVDAB at BSC block 125115580; multiplier `1000778223752807865`, amountIn `6000000000000000000`, with quotes and swap calldata. | M2 (ShareGuard fork tests), WO-02, `contracts` |
| `spike/results/capture_NVDAon_20261001T123353Z.json` | 2026-10-01T12:34:20Z | 1,294 B | Route capture for NVDAon at BSC block 125101299; multiplier `1001715248795989800`, amountIn `5000000000000000000` (5 USDT), with quotes and swap calldata. | M2 (ShareGuard fork tests), WO-02, `contracts` |
| `spike/results/capture_NVDAon_20261001T124654Z.json` | 2026-10-01T12:46:54Z | 1,290 B | Route capture for NVDAon at BSC block 125102974; multiplier `1001715248795989800`, amountIn `5000000000000000000`, with quotes and swap calldata. | M2 (ShareGuard fork tests), WO-02, `contracts` |
| `spike/results/capture_NVDAon_20261001T131936Z.json` | 2026-10-01T13:19:36Z | 14,643 B | Route capture for NVDAon at BSC block 125107331; multiplier `1001715248795989800`, amountIn `6000000000000000000`, with quotes and swap calldata. | M2 (ShareGuard fork tests), WO-02, `contracts` |
| `spike/results/capture_NVDAon_20261001T134617Z.json` | 2026-10-01T13:46:17Z | 8,272 B | Route capture for NVDAon at BSC block 125110885; multiplier `1001715248795989800`, amountIn `6000000000000000000`, with quotes and swap calldata. | M2 (ShareGuard fork tests), WO-02, `contracts` |
| `spike/results/capture_NVDAon_20261001T142236Z.json` | 2026-10-01T14:22:36Z | 13,302 B | Route capture for NVDAon at BSC block 125115724; multiplier `1001715248795989800`, amountIn `6000000000000000000`, with quotes and swap calldata. | M2 (ShareGuard fork tests), WO-02, `contracts` |
| `spike/results/flow_logs_20261004T120914Z.json` | 2026-10-04T12:08:18.824984+00:00 | 22,156,873 B | NodeReal `eth_getLogs` capture of Transfer events across 10,000 blocks (blocks `125663619` to `125673618`) for NVDAB, NVDAon, AAPLB, and AAPLon. | WO-04 (`packages/mod-flow`) |
| `spike/results/fork_NVDAB_20261001T123316Z.log` | 2026-10-01T12:33:16Z | 1,724 B | Foundry fork test log for NVDAB: 5 tests passed, 0 failed, 0 skipped. | M2 (ShareGuard fork tests), `contracts` |
| `spike/results/fork_NVDAB_20261001T124535Z.log` | 2026-10-01T12:45:35Z | 1,854 B | Foundry fork test log for NVDAB: 5 tests passed, 0 failed, 0 skipped. | M2 (ShareGuard fork tests), `contracts` |
| `spike/results/fork_NVDAB_20261001T134525Z.log` | 2026-10-01T13:45:25Z | 1,998 B | Foundry fork test log for NVDAB: 5 tests passed, 0 failed, 0 skipped. | M2 (ShareGuard fork tests), `contracts` |
| `spike/results/fork_NVDAB_20261001T142131Z.log` | 2026-10-01T14:21:31Z | 2,598 B | Foundry fork test log for NVDAB: execution log with test debug tracing. | M2 (ShareGuard fork tests), `contracts` |
| `spike/results/fork_NVDAon_20261001T123353Z.log` | 2026-10-01T12:33:53Z | 1,247 B | Foundry fork test log for NVDAon: 0 passed, 0 failed, 5 skipped (5 USDT order below minimum). | M2 (ShareGuard fork tests), `contracts` |
| `spike/results/fork_NVDAon_20261001T124654Z.log` | 2026-10-01T12:46:54Z | 1,238 B | Foundry fork test log for NVDAon: 0 passed, 0 failed, 5 skipped (5 USDT order below minimum). | M2 (ShareGuard fork tests), `contracts` |
| `spike/results/fork_NVDAon_20261001T131936Z.log` | 2026-10-01T13:19:36Z | 1,969 B | Foundry fork test log for NVDAon: 5 tests passed, 0 failed, 0 skipped. | M2 (ShareGuard fork tests), `contracts` |
| `spike/results/fork_NVDAon_20261001T134617Z.log` | 2026-10-01T13:46:17Z | 1,734 B | Foundry fork test log for NVDAon: 5 tests passed, 0 failed, 0 skipped. | M2 (ShareGuard fork tests), `contracts` |
| `spike/results/fork_NVDAon_20261001T142236Z.log` | 2026-10-01T14:22:36Z | 2,722 B | Foundry fork test log for NVDAon: execution log with test debug tracing. | M2 (ShareGuard fork tests), `contracts` |
| `spike/results/live_NVDAB_dry-run_20261001T140716Z.json` | 2026-10-01T14:07:04Z | 863 B | Live dry-run buy simulation for NVDAB: spend 6 USDT (`6000000000000000000` wei), quote, simulation, and gas estimation. | M2 (live buys), WO-02 |
| `spike/results/live_NVDAB_dry-run_20261001T142312Z.json` | 2026-10-01T14:23:11Z | 876 B | Live dry-run buy simulation for NVDAB: spend 6 USDT (`6000000000000000000` wei), quote, simulation, and gas estimation. | M2 (live buys), WO-02 |
| `spike/results/live_NVDAB_send_20261001T142346Z.json` | 2026-10-01T14:23:27Z | 1,447 B | Live mainnet transaction result buying NVDAB on BSC (tx `0x64cf517b6ca4b341da803a69649202534f590b5033c46e01a91e5318db905c10`, block 125116035): tokens/shares received, gas limit, estimate, and multiplier. | M2 (live buys), WO-02 (`packages/mod-receipts`) |
| `spike/results/live_NVDAon_send_20261001T142428Z.json` | 2026-10-01T14:24:00Z | 1,669 B | Live mainnet transaction result buying NVDAon on BSC (tx `0x91d9047b312dbb50c18b7ae5f1aa96701bbcf18a2eb24aa19277fbb4125b2dd7`, block 125116187): approval tx, swap tx, tokens/shares received, gas, and multiplier. | M2 (live buys), WO-02 (`packages/mod-receipts`) |
| `spike/results/module_probes_20261003T121018Z.json` | 2026-10-03T12:09:01.717760+00:00 | 3,779,263 B | Module viability probe run (67 test keys): Market trades, top-traders, holders, price-info, price, candles (1h/1d), advanced-info, top-liquidity, leaderboards, address tracker, RWA token tabs, portfolio overview/PNL, and DeFi investment list. | WO-00, WO-03, WO-04, WO-06, WO-10 |
| `spike/results/module_probes_20261003T123420Z.json` | 2026-10-03T12:32:52.048087+00:00 | 3,833,271 B | Module viability probe run (76 test keys): updated Market, Portfolio, and DeFi endpoints. | WO-00, WO-03, WO-04, WO-06, WO-10 |
| `spike/results/module_probes_20261003T124055Z.json` | 2026-10-03T12:39:07.720778+00:00 | 4,294,139 B | Module viability probe run (84 test keys): expanded DeFi investment and position tests. | WO-00, WO-03, WO-04, WO-06, WO-10 |
| `spike/results/module_probes_20261003T125051Z.json` | 2026-10-03T12:48:57.236533+00:00 | 4,295,246 B | Module viability probe run (84 test keys): repeated probe run verifying consistency. | WO-00, WO-03, WO-04, WO-06, WO-10 |
| `spike/results/module_probes_20261003T125520Z.json` | 2026-10-03T12:53:31.310527+00:00 | 4,297,208 B | Module viability probe run (84 test keys): repeated probe run verifying parameter responses. | WO-00, WO-03, WO-04, WO-06, WO-10 |
| `spike/results/module_probes_20261003T125812Z.json` | 2026-10-03T12:58:03.237273+00:00 | 847 B | Targeted RPC log probe (`F_logs`): testing provider block windows. | WO-04 (`packages/mod-flow`, `packages/chain`) |
| `spike/results/module_probes_20261003T125918Z.json` | 2026-10-03T12:59:02.810149+00:00 | 2,605 B | Targeted RPC log probe (`F_logs`): multi-provider `eth_getLogs` window limits. | WO-04 (`packages/mod-flow`, `packages/chain`) |
| `spike/results/module_probes_20261003T130122Z.json` | 2026-10-03T12:59:33.504237+00:00 | 4,295,756 B | Final comprehensive probe run (84 test keys): all Market, Guardian, Portfolio/Statement, Pies, Rewards/DeFi, and RPC log responses used as standard fixtures across modules. | WO-00, WO-03, WO-04, WO-06, WO-10 |
| `spike/results/receipt_vectors_20261003T170030619036Z.json` | 2026-10-03T17:00:30.619036+00:00 | 149,109 B | 5 onchain receipt reconciliation vectors derived from live F6/F11 transactions and edge cases (`f6_live_nvda_bstock_20261001`, `f6_live_nvda_ondo_20261001`, `f11_guarded_nvdab_live_20261002`, `f11_guarded_nvdaon_live_20261002`, `synthetic_edge_reconciled_with_diff`). | WO-02 (`packages/mod-receipts`) |

