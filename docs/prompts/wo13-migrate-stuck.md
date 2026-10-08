# WO-13 bug: Migrate stuck on "Waiting for the sale to confirm..." (urgent)

Same worktree and branch as WO-13/WO-07 (fast-forward to `main` first). No new branch. Commit, push, make sure an open PR has the latest push (open a new one from the same branch if PR 48 was merged).

## What the chief engineer saw
Migrate NVDAon to bStock: the sale went through, then the sheet sat on "Waiting for the sale to confirm..." with no way out. The text was also unreadable: white text on a near-white box (`migrate-sheet.tsx` uses `bg-neutral-50`, `border-neutral-200`, `text-neutral-500` on the waiting panel, which breaks the palette rule).

## Root cause (read the code, confirm in your test)
`use-migrate-flow.ts` polls `/api/receipts?hash=`. The route answers **404 only when `FEATURE_RECEIPTS` is off**. When the receipts worker is not running or has not reconciled the sale yet it answers **200 `{"state":"pending"}`**, and a failed or never-reconciling sale answers `"failed"` or `"unreconciled"`. The 2-minute cap (24 polls) applies only to the 404 branch, so every other state loops forever, with no cancel and no manual amount.

## Fix
1. One cap for every state: after 2 minutes without `reconciled`, stop polling and show the existing "enter the USDT you received" step (the validated, at least 6 USDT, typed amount), with plain words: "We could not confirm the amount automatically. Your USDT is in your wallet. Check your balance and enter what you received, or try again." Offer "Check again" (restarts the 2 minutes) and "Cancel" (keeps the pending migration so it can be resumed).
2. `"failed"`: say the sale did not go through, clear the pending migration, no buy offered. `"unreconciled"`: go straight to the typed amount.
3. While waiting, show the sale transaction link (BscScan) and the elapsed time, and never leave the user without a visible Cancel.
4. Resume after a reload must follow the same rules (it must not wait forever either).
5. Use the palette tokens (black, white, faint white, orange; no greys, no `neutral-*`); the waiting panel must be readable at 375/768/1280 and with reduced motion.
6. Tests: unit tests for the poll state machine with a fake clock for `pending` forever, `failed`, `unreconciled`, 404, a network error, and `reconciled` after 3 polls; Playwright cases for pending-forever (falls to the typed amount after the cap, Cancel works, resume works) and failed. Existing Migrate and receipt e2e stay green.
7. Report the real pack output: `FULL=1 bash scripts/review-pack.sh <branch>`, all steps and the owned-path check at exit 0.
