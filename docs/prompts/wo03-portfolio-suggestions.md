# WO-03: Portfolio suggestions (nobody sees a blank Portfolio)

You are Agent 03. Same worktree and branch as WO-03 (fast-forward to `main`); no new branch; commit, push, keep an open PR with the latest push. Logic and view-model fields only; the UI agent (Sonnet) renders them (`docs/prompts/wo12-pies-page.md`). **No regression:** behind the existing statement flag, no change to what existing holders see except an added `suggestions` field, and nothing in the quote, buy or sell paths.

## Rule
Count the **distinct tickers** the wallet holds (any issuer; a dust balance under $1 does not count). Suggest `3 - held` more, so: holds 0 (new or empty wallet, or signed-out view) suggests 3, holds 1 suggests 2, holds 2 suggests 1, holds 3 or more suggests none. No recommendation engine: this is the same short list for everyone, rotated per wallet.

## Candidates and order
1. Candidate tokens: enabled on the deployed ShareGuard (`issuersOf` and `isTokenBuyable` in `apps/web/lib/tickers.ts`; one token per ticker, the issuer with the better current liquidity), not already held.
2. "Good liquidity at the moment": read the Radar's small snapshot rows (`radar` grade rows and `flow-aggregate`; **no network calls on the request path and never the full `flow` tape**) and keep tokens graded A or B ("Liquid") that are not ghosts and whose data is not stale; order by cleaned on-chain 24 h volume, highest first.
3. Per-wallet variety: take the top 8 and rotate the starting point by a stable hash of the wallet address (a small pure function, same address gives the same order; no address is stored). So wallet A may see NVDAB first and wallet B AAPLB first.
4. If the Radar data is missing or stale, return no suggestions with the reason ("Liquidity data is catching up") rather than guessing; fixtures say "Fixture data".

## Output
`PortfolioVM.suggestions`: `{ count, items: [{ ticker, symbol, issuer, name, grade, label: "Liquid", volume24hUsd (string), reason }], state: "ok" | "none_needed" | "unavailable", reasonText }`. The reason text is plain: "Enabled in Tally's guarantee and liquid right now. Not advice." Add the same data to `/api/vm/portfolio` and keep every existing field byte-identical.

## Tests and report
Pure tests: holds 0, 1, 2, 3 and 4 tickers; dust does not count; the held ticker is never suggested; both issuers enabled picks the more liquid; rotation is stable per address and differs between two addresses; stale Radar means unavailable; shape of existing fields unchanged (compare against the existing fixtures). README roadmap line: "Smart recommendations (not built)". Report the real `FULL=1 bash scripts/review-pack.sh <branch>` output.
