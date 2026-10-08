# WO-13 Migrate: guided two-step migration between issuers

| | |
|---|---|
| Agent | 07 (Codex #2), the agent that built Sell, on its existing worktree and branch `mod/WO-07-switch` (fast-forward it to main; no new branch, so the review pack checks WO-07's Owns, which list this work's paths) |
| Flag | `FEATURE_SWITCH` (the existing `switch` flag; it now means "Migrate") |
| Read first | `README.md` (Roadmap: atomic migration), `MODULES.md` §5 (gates V-B1, V-B2), `docs/work-orders/WO-07-switch.md`, `apps/web/components/trade/use-sell-flow.ts`, `sell-sheet.tsx`, `use-trade-flow.ts`, `apps/web/modules/switch/view-model.ts` |

## Why two steps
The Binance aggregator refuses a direct stock-to-stock route (`40368`, gate V-B1 failed), so a one-transaction migration is impossible today. Selling to USDT and buying the destination both work. **Migrate** is a guided flow of exactly those two existing, separately signed transactions, labelled as two steps with no pretence of atomicity. The atomic migrator contract (one transaction) stays on the README roadmap as "Atomic Migrate".

## What it does
A **Migrate** action on a Portfolio row (Ondo or bStock holding, where the other issuer of the same ticker is buyable through the guarantee). The user picks all or part of the position and the destination issuer, then:
1. **Step 1, sell to USDT**: the existing sell flow (exact-amount approval, router minimum-receive, user signs each transaction).
2. The flow waits until the sale is mined and reads the **verified USDT received**: from the worker-verified receipt (`GET /api/receipts?hash=`, flag `FEATURE_RECEIPTS`) when available; otherwise from the wallet's USDT balance rise (`/api/portfolio` `wallet.usdt` before and after), labelled "from your wallet balance". The proposed buy amount is that figure rounded **down** to the cent; the user sees and confirms it.
3. **Step 2, buy the destination**: the existing guarded buy flow (the guarantee's minimum shares), user signs each transaction.
4. A combined result: the two legs side by side with their transaction links, shares before and after, and the line "Two separate transactions; the price can move between them."

## Rules it must enforce
- Real shares everywhere (bigint maths, the issuer multiplier; an unknown multiplier blocks the migration with the reason, never 1:1). Source and destination share counts are shown in shares, not tokens.
- Eligibility, each with a plain reason when not met: source is Ondo or bStock (xStocks: "No market to exit this token on BNB Chain"); destination is the other issuer of the same ticker, buyable through ShareGuard (`isBuyable`) and executable (not a ghost market, not paused); the sale is at least the sell minimum; the **expected USDT proceeds are at least 6 USDT** (the buy minimum), otherwise "Too small to migrate: the buy needs at least 6 USDT. You can sell to USDT instead."
- Persist progress in `tally.pendingMigrate` (id, ticker, from, to, step, sale hash, USDT before, USDT received, buy hash, created time; 24 hours). After a reload or a closed tab the flow **resumes at the right step**. If the user stops after step 1 the screen says exactly "Sold X for Y USDT. Not bought yet. Your USDT is in your wallet" with a "Buy now" button; never an automatic retry, never an automatic second step.
- Facts, never advice. Fixture or recorded data is never labelled live.

## Owns
- `apps/web/modules/switch/**` and `apps/web/app/dev/switch/**` (moved here from WO-07): add `MigrateVM` (eligibility, steps, amounts as strings, partial state) with the loader and the plain component.
- New: `apps/web/lib/migrate/**` (pure state machine, storage, amount maths, with tests), `apps/web/components/trade/use-migrate-flow.ts`, `migrate-sheet.tsx` (+ tests), `apps/web/e2e/migrate.spec.ts`.
- Approved, **additive only**: in `apps/web/components/portfolio/portfolio.tsx` render the Migrate entry next to the Sell button when `flags.switch` is on (one small hunk; the UI agent edits this file too, so rebase before opening the PR); in `apps/web/components/trade/trade-client.tsx` change the "Migrate between issuers" coming-soon item only when Migrate is enabled.
- Approved 2026-10-08, additive: the combined Migrate receipt (`docs/prompts/wo13-migrate-receipt.md`): `apps/web/components/trade/migrate-receipt*` and `apps/web/lib/migrate/receipt*` (+ tests), the stored-plan shape in `apps/web/lib/migrate/state.ts`, and the done card in `migrate-sheet.tsx`; and the shareable permalink: new route `apps/web/app/receipt/migrate/**` and `apps/web/lib/server/migrate-receipt*` (+ tests). This is the one new route Migrate may add; no other route changes.
- Approved 2026-10-08 (round 2 of the receipt), additive: `apps/web/components/trade/share-receipt-button.tsx`, `apps/web/app/dev/migrate-receipt/**` (dev preview, same gate as the other `/dev` pages), `apps/web/e2e/migrate-receipt.spec.ts`. No PNG snapshot baselines in git; `packages/**` stays off limits.
- **Do not edit** `use-trade-flow.ts`, `use-sell-flow.ts`, `trade-stages*`, `lib/trade-plan/**`, any `packages/**`, ShareGuard or the routes. Compose the existing hooks and components. If that is impossible without touching a buy-path file, stop and ask.

## Exit checks
- [ ] State machine tests: each step, resume from every persisted state, partial state after step 1, expiry after 24 hours, a failed or rejected leg stays exactly where it failed, no automatic transition.
- [ ] Amount tests (bigint): Ondo 10-shares-per-token and bStock 1:1 conserve shares in the display, round down to the cent, proceeds under 6 USDT blocked, unknown multiplier blocked.
- [ ] Playwright (fixture mode, mock wallet, stubbed sell and receipt routes as in `e2e/sell.spec.ts`): the full two-step migration, the resume after reload, the ineligible cases (xStocks, too small, destination not buyable), flag off hides everything; at 375 / 768 / 1280 and with reduced motion.
- [ ] The existing sell, buy and landing e2e stay green; `use-trade-flow.ts` and `use-sell-flow.ts` are byte-identical to main.
- [ ] User-run: one live Migrate of a position worth about $7 or more (commands and the expected reading in the PR).

## Timing
The ShareGuard expansion is Agent 09's (`docs/prompts/wo09-shareguard-expansion.md`) and runs in parallel on different files; Agent 07 does Migrate only. Target merge **Thursday 8 Oct, midday UTC**, flag `FEATURE_SWITCH`. If it is not ready by the cut line (Thursday 23:59) it ships off. The UI agent restyles the sheet afterwards; build it with the existing components and tokens so it is usable now.

Extra approvals (2026-10-07): see the last paragraph of `docs/work-orders/WO-07-switch.md` (holdings-vm, portfolio-vm, sell-sheet `isMigrate`, vm-seed).

