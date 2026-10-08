# WO-13: Migrate must not depend on the receipts worker to learn what a sale paid

Same worktree and branch as WO-13/WO-07 (fast-forward to `main` first). No new branch; commit, push, keep an open PR with the latest push (new PR from the same branch if the last one merged).

## Problem (seen live, 8 Oct)
A saved Migrate whose sale confirmed hours ago sits on "Waiting for the sale to confirm... Elapsed 98s" and will never finish. Why: `/api/receipts?hash=` only answers from what the receipts **worker** reconciled, and the worker only follows transactions that arrived with a short-lived hint (hint TTL 15 minutes, store window 2 minutes). An old sale, a restart, a stopped worker or a lost hint means the answer is "pending" forever. The 2-minute cap you added only moves the user to typing the amount by hand. The server should answer this question itself, from the chain.

## Build
1. A read-only route `GET /api/trade/sale-proceeds?hash=0x…` (zod-validated hash, per-IP rate limit like its neighbours, flag gate `FEATURE_SWITCH`; 404 when off). It reads the transaction receipt through `engine.transactions.getReceipt(hash)` and answers, all from chain data only:
   - `{ state: "pending" }` if the transaction is not mined yet or the node does not know it;
   - `{ state: "failed" }` if it reverted;
   - `{ state: "confirmed", usdtReceivedRaw, tokensSpentRaw, stockToken, blockNumber }` when mined: USDT `Transfer` logs to the transaction's sender, summed; exactly one registry stock token transferred from that sender (the same rule as the permalink loader: reuse that code by extracting the sale-leg parse into a shared function inside `apps/web/lib/server/migrate-receipt*`, with the permalink loader calling it, no behaviour change there); if the logs do not look like a sale of one stock for USDT, `{ state: "unrecognised" }`.
   It never returns logs, provider details or anything but those fields. An RPC failure is a 503 with a plain message, not "pending".
2. `use-migrate-flow.ts`: when waiting for the sale, ask this route first (every 5 seconds); `confirmed` gives the proceeds immediately (source "chain"), `failed` clears the saved migration with a plain message, `unrecognised` goes to the typed amount, `pending` keeps waiting up to the existing 2-minute cap. `/api/receipts` becomes optional (used only to show the receipt link); its absence, or a stopped worker, must not change the outcome. The saved sale must still resume after a reload at any later time: the answer is on chain.
3. Proceeds are still checked: at least 6 USDT, rounded down to the cent for the buy, shown as "from the chain". The typed amount remains the last resort.
4. While here, fix what the screenshot shows: the waiting panel is a solid white card on a dark modal; use the same dark glass panel as the other modal content (palette: black, white, faint white, orange; no solid white fill), and the Cancel button has a lighter rectangle behind its text (a text-selection or background span): it must be the plain orange pill.
5. Tests: unit tests for the route with a fake engine (pending, failed, confirmed, two stock tokens, no USDT, RPC failure, bad hash, flag off); poll-state tests that a stopped worker still completes through the chain route; Playwright for reload-and-resume of an old sale in fixture mode (pseudo hash that the fixture chain recognises, as the other Migrate e2e do).
6. Run `FULL=1 bash scripts/review-pack.sh <branch>` and paste the real output (all steps and the owned-path check at exit 0).

## Also (wallet binding, from the 8 Oct wrong-wallet bug)
`tally.pendingMigrate` (`apps/web/lib/migrate/state.ts`) is not tied to a wallet: another account signing in on the same browser would see the previous account's saved migration and could resume it. Store the wallet address when saving and ignore (and remove) a saved migration whose wallet differs from the signed-in wallet; keep the 24-hour expiry. The old stored shape without an address must be discarded safely. Add tests (same wallet resumes, different wallet ignored and removed, old shape).
