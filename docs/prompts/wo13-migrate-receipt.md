# WO-13 follow-up: one Migrate receipt

Stay in your existing worktree and branch (fast-forward to `main` first). No new branch. Commit, push, keep an open PR with the latest push (open one from the same branch if the last was merged).

## Why
The chief engineer's live Migrate worked. The done card shows two separate Receipt buttons. A Migrate should end in **one receipt** that shows what was given up and what was received, in tokens, shares and dollars, so the user sees the share-true point: moving issuer changes the token count, the share count stays about the same, and the dollar value is conserved less fees and price movement.

## Build
A combined **Migrate receipt** (modal, opened from the done card; replaces the two buttons; keep small links to the two transaction receipts and BscScan underneath). Sections, in this order:

1. **You gave up**: source token symbol, token amount (from the verified sale: `tokensSpent`), shares it represented (token amount × the source multiplier), USD value.
2. **You received**: destination token symbol, token amount and shares from the verified buy (the guard's `Guarded` event as the existing buy receipt reads it), USD value.
3. **Share-true comparison** (the headline): `0.0254 NVDAB = 0.0254 shares` to `0.2540 NVDAon = 0.2540 shares`-style two lines, then the **share difference** and the **dollar difference** (USDT out of leg 1 vs USDT spent in leg 2, plus the two fees). Show the real numbers, whatever they are. Never say "value unchanged"; say "Difference" and let the numbers speak. If the share count went down because of fees or price movement, show it as down.
4. **Protection** per leg: the sale's guaranteed minimum USDT and the buy's minimum shares floor, each next to what was actually delivered, with a pass mark only when delivered >= floor (verified, not assumed).
5. **How it was executed** per leg: route (as quoted), vendor, quote time, "simulated at the gas limit sent" yes or no (use the plan's `simulation` field; if absent say "not recorded", never "yes"), transaction value (0 BNB for both), gas used, block, hash.

## Data rules
- Label every figure **Verified** (from the chain receipt or the worker-verified `/api/receipts` result) or **As quoted** (from the plan the user signed). Anything not yet verified shows "Pending" and no number. Do not fill it from the quote.
- Plan details (route, vendor, quote time, simulation, the floors) must be saved in `tally.pendingMigrate` at signing time so a reload or a later open still has them; extend the storage shape and the 24 hour expiry; add a state migration so a stored old-shape value does not crash.
- All amounts are bigint or strings; shares are computed from the multiplier used at the time, taken from the plan, not re-read. A missing multiplier shows "shares unavailable", never 1:1.
- The USD values use the USDT amounts of the two legs, not a live price.
- Fixture mode: the receipt carries the same "Fixture data" label the other receipts do.
- No new routes or packages; no change to ShareGuard, the buy path, `use-trade-flow.ts` or `use-sell-flow.ts` (stay byte-identical). If a field you need is only reachable by editing those, stop and ask. A permalink page for a finished Migrate is NOT in scope.

## Tests
Receipt view-model unit tests (conserved shares, shares down by fees, shares up, missing multiplier, not-yet-verified leg, old stored shape), and a Playwright case in `e2e/migrate.spec.ts` for the done card opening the receipt at 375 / 768 / 1280 and reduced motion. Existing e2e stays green.

Palette rule applies (black, white, faint white, orange; no greys). Run `FULL=1 bash scripts/review-pack.sh <branch>` on a quiet machine and paste the result.
