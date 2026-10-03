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
