# WO-04 Flow + Radar page

| | |
|---|---|
| Agent | B (Codex #1), after WO-00 |
| Branch | `mod/WO-04-flow` |
| Read first | `MODULES.md` §4.3, blueprint §7.5 (integrity grade) and M4 (Trap Shield), `IDEAS.md` F1, F10 |
| Fixtures | `spike/results/module_probes_20261003T130122Z.json`: `F_trades_*`, `F_holder_*`, `F_top_trader_*`, `F_candles_*`, `F_logs` (NodeReal sample logs) |

## Owns

- `packages/mod-flow/**`
- `apps/worker/src/jobs/collect-flow.ts`, `apps/worker/src/jobs/flow.ts`
- Approved 2026-10-08 (EC2 disk retention, `docs/prompts/wo04-flow-retention.md`): `apps/worker/src/jobs/prune.ts`, `apps/worker/src/prune.test.ts`
- Approved 2026-10-09 (`docs/prompts/wo04-radar-speed.md`): `apps/web/modules/flow/**` (loaders read `flow-aggregate`/`flow-ghost`, cache, log line) and `apps/web/app/api/vm/radar/**`, with their tests. Also approved (additive test seed): `apps/web/e2e/radar-seed.ts`, to seed `flow-aggregate` and `flow-ghost` next to the existing tape.
- `apps/web/modules/flow/**`, `apps/web/app/dev/flow/**`
- Approved 2026-10-03, **additive only** (no change to existing signatures or behaviour):
  - Market collectors in `packages/binance/src/collectors.ts`, `packages/binance/src/collector-fixtures.ts`, `packages/binance/src/collectors.test.ts`: `trades(token, cursor?, limit?)`, `holders(token)`, `topTraders(token)`, `topLiquidity(token)` with zod schemas; fixture fetch mapped to the `F_*` probe keys
  - Chain reader in a new file `packages/chain/src/logs.ts` (+ `packages/chain/src/logs.test.ts`, export line in `packages/chain/src/index.ts`): `transferLogs(token, fromBlock, toBlock)` (≤ 10,000 blocks), `blockNumber()`, `transactionReceipt(hash)`, over `BSC_RPC_NODEREAL` then `BSC_RPC_ANKR` with failover
  - Exposure on the engine in `packages/engine/src/**` (`engine.collectors.*`, `engine.chain.*`)
  - New read-only recorder `spike/record_flow_logs.py` and its output `spike/results/flow_logs_*.json`

## Tasks

1. **Classifier** (pure): from a trade (`changedTokenInfo` legs), keep only legs whose counterpart is a dollar stablecoin (USDT, USDC, USD1, USDon: addresses in a constant), compute price per share from amounts and the multiplier, side (buy/sell), size in shares and USD.
2. **Labels** (pure): `bot` (from top-trader: bought+sold ≥ 50× current holding and ≥ $50k turnover, thresholds in constants); `custody` (holder ≥ 20% of supply with `fundingSourceLabel.tagName === "CEX Wallet"`); configurable lists.
3. **Aggregates** (pure): net flow in shares per issuer for 1h/24h/7d, buy/sell counts, last real trade age, top-10 concentration excluding custody, whale prints (≥ $10k).
4. **Ghost rule input**: cleaned 24h real volume and last-real-trade age, exported for the integrity grade. Add the check to the grade only through a new function in your package that core's grade can call via an injected port; **do not edit `packages/core/src/integrity.ts`**. Propose the one-line wiring change in the PR; the orchestrator applies it.
5. **Collector** `collect-flow`: page `market/trades` by cursor per registry token (rate ≤ 4 req/s shared), holders/top-traders every 10 min; on API failure fall back to NodeReal `eth_getLogs` Transfer (≤ 10,000 blocks per call; tail mode from the last seen block) through `withFallback`, classifying logs with the same rules and marking `source: "chain-logs"`.
6. **View models** (UI split: you ship the logic and a typed view model plus a plain, unstyled component in `apps/web/modules/<name>/`; the UI agent (WO-12, Sonnet) builds the real page from your view model. Don't style, don't create pages outside `apps/web/app/dev/<name>/`.): `RadarVM` (per-ticker cards: grade + reasons, filters for issuer / grade / ghost) and `FlowPanelVM` (net flow in shares per issuer per window, buys/sells, last real trade age, concentration, whale prints, `source`, `stale`, `ageMs`). Data from snapshots only. The UI agent builds the Radar page.

## Exit checks

- [ ] Classifier test: the NVDAB vs JARVIS trade in the fixture is excluded; a USDT leg is kept with the right price per share (± 0.01%).
- [ ] Bot and custody labels on the fixture's top NVDAB trader and top NVDAB holder.
- [ ] Fallback test: API mocked down → logs path used, `onWarn` called, panel marked "from chain logs".
- [ ] Stale test: snapshot older than 15 min → panel shows age, not "live".
- [ ] Flag off → `RadarVM` has no flow panel and the plain component still shows the grade.

## Out of scope

Copy-trading, leaderboards (roadmap), Guardian rules (WO-06 reads your snapshots).
