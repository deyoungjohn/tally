# WO-01: fewer failed buys on market-maker (RFQ) routes (the chief engineer relaxes the buy-path rule for this one change)

Same worktree and branch as WO-01 (fast-forward to `main` first). No new branch; commit, push, open a PR from the same branch.

## Authorisation (2026-10-09, chief engineer)
`AGENTS.md` forbids changing the existing buy path. The chief engineer explicitly allows **route selection only** for buys, to reduce failures. Still off limits: `contracts/src/ShareGuard.sol` and every contract file, the guard's floor and minimum-shares logic, the multiplier and feed logic, `use-trade-flow.ts`, the receipt and fill logic, and anything in fair-value or integrity grading. Record this approval in the WO-01 Owns section of your branch exactly as written in `docs/work-orders/WO-01-m3-trade.md` on `main`.

## Why
On 9 Oct three sales of TSMB reverted on chain with `RFQ_OrderExpired`: the best route was a market-maker order that lives a few seconds. Sales are fixed (PR 67: `pickSellRoute` in `packages/engine/src/sell.ts` prefers a pool route within 0.5% of the best RFQ output and flags an RFQ-only route). A guarded buy uses the same aggregator routes, so it can fail the same way (the TSMB buy proof used `Rfq Neptunex:TSMB`).

## Do
1. Move `isRfqRoute` and `pickSellRoute` out of `sell.ts` into a shared `packages/engine/src/route-choice.ts` (same behaviour, same tests, `sell.ts` imports it; the sell tests must pass unchanged).
2. Buy plan: in `packages/engine/src/trade.ts` (the `pickBest(routes)` call in `prepare`) use the shared chooser instead. When the chosen route is RFQ, set `plan.rfq = true` and add the warning "Market-maker quotes expire in a few seconds. Confirm promptly." The plan's `quotedShares`, `minShares` and the guard calldata are built from the **chosen** route exactly as today; the floor is computed the same way.
3. Consistency: the price the user sees before the plan (the consolidated quote, `packages/binance/src/adapters.ts` around the `pickBest` call) must come from the same route choice, otherwise the card promises the RFQ price and the plan delivers the pool price. Make the smallest change that keeps card and plan consistent; if that cannot be done without touching `packages/core`, stop and ask. When no RFQ route exists (the usual case and all existing fixtures), behaviour and every recorded expected number must be byte-identical.
4. The buy sheet already fetches a fresh plan on Confirm; do not change `use-trade-flow.ts`. If the plan carries `rfq`, show the warning text through the plan's existing `warnings` display only (no new UI component).
5. Tests: the same route-choice cases as sell (pool within 0.5%, RFQ better by more than 0.5%, RFQ only, no route), the plan numbers built from the chosen route with the floor unchanged, an unchanged-numbers regression over the existing buy fixtures, and a quote/plan consistency test. All existing trade, quote and e2e tests stay green.
6. In the PR, report from the recorded quotes (`spike/results/`, `packages/binance/fixtures/raw/`, `contracts/captures/`) which tokens have RFQ-only routes today and how often an RFQ route was best. Run `FULL=1 bash scripts/review-pack.sh <branch>` on a quiet machine and paste the real output. The chief engineer will live-test one $6 buy of a token that has an RFQ route before it is merged.
