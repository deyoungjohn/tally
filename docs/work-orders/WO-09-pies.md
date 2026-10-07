# WO-09 Pies

| | |
|---|---|
| Agent | B (Codex #1), after WO-04 |
| Branch | `mod/WO-09-pies` |
| Read first | `MODULES.md` §4.7 |

## Owns

- `packages/mod-pies/**` (including `templates/*.json`)
- `apps/web/modules/pies/**`, `apps/web/app/dev/pies/**`
- `apps/worker/src/jobs/pies.ts`

## Tasks

1. Templates as JSON in the repo (the API's `tabId` filters are ignored): Mag 7, AI Chips, "Berkshire 13F" (top holdings from the latest 13F, with filing date and source URL), each `{ ticker, targetWeightBps }`. Mapping to available tokens per issuer with the integrity grade; unavailable tickers are listed, never silently dropped.
2. Weights in **dollars of shares** using each issuer's multiplier (bigint).
3. `rebalancePlan(holdings, template, prices, minOrderUsdt = 6)`: sells first, then buys; legs below 6 USDT are deferred and shown; drift threshold configurable.
4. Execution: legs through WO-07 Sell and WO-01 guarded buy; each leg a receipt; partial completion state is persisted and shown exactly.
5. View models (UI split: you ship the logic and a typed view model plus a plain, unstyled component in `apps/web/modules/<name>/`; the UI agent (WO-12, Sonnet) builds the real page from your view model. Don't style, don't create pages outside `apps/web/app/dev/<name>/`.): `PieTemplatesVM`, `PieVM` (current vs target, drift, unavailable tickers) and `RebalancePlanVM` (legs, deferred legs, fees, partial state). The UI agent builds the Pies page.

## Exit checks

- [ ] Plan tests: Ondo 10-shares-per-token token weighted correctly vs bStock 1:1; sub-6-USDT legs deferred; sells before buys.
- [ ] A failed leg → "partially rebalanced" with exact state, no retry.
- [ ] View-model tests: empty pie, drift below threshold (no plan), partial state.

## Out of scope

Pooled vaults, automatic scheduled rebalancing.

## Slice A (2026-10-05): logic, templates and view models only; flag-off

Ships first, on `mod/WO-09-pies` from fresh `main`. No execution, no worker job, no routes, no styling (task 4 and the worker job are slice B, after the Sell UI). **Executable templates use only the five assets ShareGuard supports: NVDA, AAPL, TSLA, QQQ, SPY** (`BUYABLE_TICKERS` in `apps/web/lib/tickers.ts`; the pure package receives the set as an input). Templates: `tech-trio` (NVDA 4000, AAPL 3500, TSLA 2500 bps), `index-core` (QQQ 6000, SPY 4000), `growth-five` (NVDA 3000, AAPL 2500, TSLA 1500, QQQ 2000, SPY 1000), plus `mag7-preview` (AAPL, MSFT, AMZN, GOOGL, META, NVDA, TSLA) marked `executable: false` with its unavailable tickers listed. No Berkshire 13F template (the data would have to be invented; roadmap). Weights are example allocations, labelled "example allocation, not advice".

Approved 2026-10-05, **additive only**: edit `apps/web/app/dev/guardian/page.tsx` to remove its unused optional `_props` argument (`export default async function GuardianDevPreview()`), because Next's generated route types reject it once another dev page is added. No other change to that file; it already ignores query parameters and must keep doing so.

Approved 2026-10-06, **additive only**: the one-line test change in `apps/web/modules/guardian/view-model.test.ts` that calls the zero-argument Guardian page through `Reflect.apply` with the same query-ignore assertion (needed because of the `_props` removal above). No other edit to that file.

## ShareGuard expansion (2026-10-07, moved from Agent 07)

Slice B (Pies execution) stays on hold. New work for Agent 09, on the existing branch `mod/WO-09-pies`: enable more tokens on the **deployed** ShareGuard without changing `contracts/src/ShareGuard.sol`. Full instructions: `docs/prompts/wo09-shareguard-expansion.md`. Approved, additive, Owns:
- `contracts/tools/list_candidates.py`, `contracts/tools/list_enabled.py`, `contracts/tools/gen_buyable.py`
- `contracts/script/AddAssets.s.sol` and its Foundry test under `contracts/test/`
- `contracts/deploy/assets.json`, `contracts/deploy/seeds.json`, new files in `contracts/captures/`
- `contracts/README.md` (the "Expanding the asset list" section)
- `apps/web/lib/buyable.generated.ts` (new) and, in `apps/web/lib/tickers.ts`, only the definition of `BUYABLE_TICKERS` (same exported shape)
- Added 2026-10-07 for Batch 1: `contracts/script/capture_batch.sh` (new) and its list file under `contracts/deploy/` (see the Batch 1 section of `docs/prompts/wo09-shareguard-expansion.md`).

