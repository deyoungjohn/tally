# WO-07 Sell + Switch issuer

| | |
|---|---|
| Agent | A (Claude Code), after WO-01 |
| Branch | `mod/WO-07-switch` |
| Read first | `MODULES.md` §4.5 and `docs/archive/MODULES-v1.md` §3.1–3.2, §5, §7, `contracts/README.md`, `IDEAS.md` F4, F11 |
| Gates | V-B1/V-B2 results from the user (Mon) decide whether one-route Switch ships |

## Owns

- `contracts/test/ShareGuardSwitch.t.sol` (fork tests J, K), new captures in `contracts/captures/`
- `apps/web/components/portfolio/row-actions/**` (plugs into WO-03's `rowActions` slot), `apps/web/lib/trade-plan/sell.ts`, `apps/web/lib/trade-plan/switch.ts`
- `packages/mcp/src/tools/sell.ts`, `packages/mcp/src/tools/switch.ts`

## Tasks

1. `TradeIntent` union (`buy | sell | switch`) reusing WO-01's plan pipeline (plan → simulate at exact limit → sign → `onStage` events so Receipts records them).
2. Sell: stock → USDT quote with `userWalletAddress` = user; user signs the API transaction directly; floor = router `minReceiveAmount` from tolerance.
3. Switch: one route through the **deployed** ShareGuard (`tokenIn` = source stock, `stock` = destination, floor in destination shares); show shares in, shares out, cost %, fee, both grades. If no direct route: show "Sell then buy" as two clearly separate steps, or hide Switch (no fake atomicity).
4. Fork tests J (switch succeeds through deployed bytecode, floor holds, source spent or refunded) and K (floor too high reverts, user tokens untouched).
5. xStocks as source: "No market to exit this token on BNB Chain" (from WO-04's ghost flag).

## Exit checks

- [ ] Fork tests J and K pass on a capture.
- [ ] Unit tests for intent building and floor maths (bigint).
- [ ] User-run live $6 sell and $6 switch both reconcile in Receipts (commands in the PR).
- [ ] No change to `contracts/src/ShareGuard.sol` or the buy path.

## Out of scope

ShareGuard v1.1 (separate proposal if V-B1 fails), autopilot.
