# WO-07 Sell + Switch issuer

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
