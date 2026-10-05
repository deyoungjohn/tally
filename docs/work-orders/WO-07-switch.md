# WO-07 Sell (Switch cut 2026-10-05)

> **Scope change 2026-10-05:** gate V-B1 failed (`40368`, Ondo tokens only pair with stablecoins), so one-route Switch cannot exist. Switch, fork tests J and K, `switch-call.ts` and the switch route are **cancelled**. This work order is Sell only; the switch sheet shows "unavailable" with that reason. Receipts for sells follow as a separate additive change.


| | |
|---|---|
| Agent | C (Codex #2), after WO-02 (moved from Sonnet so its quota goes to UI) |
| Branch | `mod/WO-07-switch` |
| Read first | `MODULES.md` §4.5 and `docs/archive/MODULES-v1.md` §3.1–3.2, §5, §7, `contracts/README.md`, `IDEAS.md` F4, F11 |
| Gates | V-B1/V-B2 results from the user (Mon) decide whether one-route Switch ships |

## Owns

- `contracts/test/ShareGuardSwitch.t.sol` (fork tests J, K), new captures in `contracts/captures/`
- `apps/web/modules/switch/**` (row-action view models for Portfolio), `apps/web/app/dev/switch/**`
- New files `apps/web/lib/trade-plan/sell.ts` and `apps/web/lib/trade-plan/switch.ts` only (the rest of `trade-plan/` is WO-01's; reuse it, don't edit it)
- `packages/mcp/src/tools/sell.ts`, `packages/mcp/src/tools/switch.ts`
- **Correction (2026-10-05):** `apps/web/lib/trade-plan/` does not exist; the buy plan pipeline is `packages/engine/src/trade.ts` (`engine.trade.prepare`) behind `apps/web/app/api/trade/plan/route.ts`. The two `lib/trade-plan/*.ts` files are thin client helpers that call the new routes below.
- Approved 2026-10-05, **additive only** (new files and accessor lines; no change to `trade.ts`, `encodeSwapCall`, `contracts/src/**` or the buy path): `packages/engine/src/sell.ts` and `packages/engine/src/switch.ts` (+ tests) with accessor lines in `packages/engine/src/engine.ts` (`engine.trade.prepareSell` / `prepareSwitch` or equivalent); a new encoder file `packages/chain/src/switch-call.ts` (+ test) for `swapForShares` with a stock as `tokenIn` (the existing `encodeSwapCall` stays USDT-only), exported with one line in `packages/chain/src/index.ts`; API routes `apps/web/app/api/trade/sell/route.ts` and `apps/web/app/api/trade/switch/route.ts` (+ tests) mirroring the plan route's validation, rate limit and error mapping. `BinanceApi.quoteRoutes` already accepts `fromToken`, so no binance change is expected; ask first if one is needed.
- **Order:** sell first (needs gate V-B2). Switch only after gate V-B1 passes and fork tests J and K are green. Receipts for sells and switches need an additive extension of `packages/mod-receipts` (today `verifySignedCall` accepts only a ShareGuard buy with USDT in and the USDT approval): propose it to the orchestrator as a separate additive file once the sell route works; do not edit `verification.ts` yet.
- Contract with WO-05 (decided 2026-10-04): each of these files must `export async function register(registry: ToolRegistry, engine: Engine)` (types from `packages/mcp/src/registry.ts`) and call `registry.add(definition, handler)`. WO-05's loader warns and skips a malformed file.

## Tasks

1. `TradeIntent` union (`buy | sell | switch`) reusing WO-01's plan pipeline (plan → simulate at exact limit → sign → `onStage` events so Receipts records them).
2. Sell: stock → USDT quote with `userWalletAddress` = user; user signs the API transaction directly; floor = router `minReceiveAmount` from tolerance.
3. Switch: one route through the **deployed** ShareGuard (`tokenIn` = source stock, `stock` = destination, floor in destination shares); show shares in, shares out, cost %, fee, both grades. If no direct route: show "Sell then buy" as two clearly separate steps, or hide Switch (no fake atomicity).
4. Fork tests J (switch succeeds through deployed bytecode, floor holds, source spent or refunded) and K (floor too high reverts, user tokens untouched).
5. xStocks as source: "No market to exit this token on BNB Chain" (from WO-04's ghost flag).
6. View models (UI split: you ship the logic and a typed view model plus a plain, unstyled component in `apps/web/modules/<name>/`; the UI agent (WO-12, Sonnet) builds the real page from your view model. Don't style, don't create pages outside `apps/web/app/dev/<name>/`.): `SellSheetVM`, `SwitchSheetVM` (shares in, shares out, cost %, fee, both grades, floor, availability reason).

## Exit checks

- [ ] Fork tests J and K pass on a capture.
- [ ] Unit tests for intent building and floor maths (bigint).
- [ ] User-run live $6 sell and $6 switch both reconcile in Receipts (commands in the PR).
- [ ] No change to `contracts/src/ShareGuard.sol` or the buy path.

## Out of scope

ShareGuard v1.1 (separate proposal if V-B1 fails), autopilot.

## Receipts extension for sells: how to propose it (2026-10-05)

Write the proposal in your tab and wait for the orchestrator's answer; an approval is recorded in **Owns** above. A proposal must list: (1) the new files, (2) every existing file you must touch additively (expected: `packages/mod-receipts/src/hints.ts` parser, `verification.ts` call branch or a new `verification-sell.ts`, `apps/web/modules/receipts/ingestion.ts`, `apps/worker/src/jobs/receipts.ts`, the receipts view model), (3) the tests. Rules it must satisfy: a sell is recognised only when the transaction goes to `LIQUIDMESH_ROUTER`, `value` is 0, the sender equals the hint's user and the stock is in the trusted registry; the stock approval is accepted only to ShareGuard's configured `approveTarget` with a non-zero, non-unlimited amount; realized figures (stock tokens sent, USDT received by the user, gas, status) come only from chain logs, never from the browser; the browser's floor is shown as client-reported; no change to buy verification behaviour; sells stay out of the `/quality` buy distributions.

