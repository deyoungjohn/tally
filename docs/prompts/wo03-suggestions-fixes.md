# WO-03: Portfolio suggestions, three fixes from review (PR 69)

Same worktree and branch, no new branch; push to PR 69 (or a new PR from the same branch if it merged).

1. **Never suggest from unknown holdings.** In `loadPortfolio` / `loadSuggestionsFromStore` (`apps/web/modules/statement/view-model.ts`), a signed-in wallet whose statement snapshot is missing or stale is not a wallet that holds nothing: the holdings are unknown, so return `state: "unavailable"` with the reason "Your holdings are still loading" (and no items). Only a signed-out visitor, or a signed-in wallet with a fresh statement that really lists fewer than 3 stocks, gets suggestions. Tests: signed-in without a statement, with a stale statement, with a fresh empty statement (suggests 3), and signed out (suggests 3).
2. **One stale radar row must not hide everything.** Remove the global `radarStale` gate: stale rows are already skipped per candidate. Report `unavailable` only when no fresh eligible candidate remains. Test: 29 fresh candidates and one stale row still yields suggestions.
3. **Fixtures are never labelled live.** When running on fixtures (`isFixture`), the suggestions' `reasonText` and each item's `reason` must say "Fixture data" even in the `ok` state (add `fixture: true` to the VM so the UI can show the tag). Test it.
Keep every existing field byte-identical and the pack green: `FULL=1 bash scripts/review-pack.sh <branch>`, real output please.
