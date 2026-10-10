# Milestones after the hackathon build

Larger pieces of work that are not part of the 11 Oct submission. They can be done in any order; each is independent. The original build milestones (M0 to M7) are in `TALLY_BLUEPRINT.md` §17. Status is one of: not started, in progress, done. Add a new milestone at the bottom with the same headings.

## 1. Make the 1-hour, 24-hour and 7-day windows always available

**Status:** not started

**Why.** On the Radar, each issuer's flow panel has three windows (last hour, last 24 hours, last 7 days). Today they often read "History still building", because the Flow collector cannot guarantee a complete trade history for every token.

**What is known (9 to 10 Oct 2026).**
- The collector reads trades 100 at a time from Binance, then expects its next poll's first page to overlap the previous poll's newest trade. When a cycle is longer than the page can cover (busy tokens, a slow cycle, an outage), there is no overlap and the history is marked incomplete ("tail page does not overlap the previous poll").
- A first scan back 7 days is limited by a page budget per token per cycle ("pagination budget reached"); busy tokens cannot be paged back that far within Binance's rate limit (about 4 requests a second shared by every process).
- Each stored `flow` snapshot holds the whole merged trade tape (about 1 to 1.6 MB per token), rewritten every cycle. Retention (30 minutes) and the Radar reading the small `flow-aggregate` rows fixed disk and page speed, not coverage.
- Evidence and proposals: `docs/prompts/wo04-flow-retention.md`, `docs/prompts/wo04-radar-speed.md`, the PR 64 and PR 52 descriptions (Agent 04's note on a bounded event store).

**Direction to evaluate (not decided).** Store each classified trade once in a bounded seven-day event store with a light latest row that references it; adaptive page budgets (more pages for the busiest tokens, fewer for quiet ones); an explicit per-window "coverage" figure shown to users instead of a binary; a backfill job separate from the live poll; the chain-log source as the reliable fallback (needs a working RPC).

**Done when.** For the 30 enabled tokens, all three windows are complete at least 95% of the time over a week, with a measured report; a window that cannot be complete says why in plain words; no change to any displayed number for a complete window.

## 2. The landing page

**Status:** not started

**Why.** `tallyprotocol.xyz` currently redirects to the app (`app.tallyprotocol.xyz`). A landing page explains the product to a first-time visitor before they reach a wallet prompt.

**Scope.** One page on the apex domain: the share-true idea in one screen (the unit trap with real numbers), what Tally does, who it is for, a "Launch app" button, links to the docs, GitHub and the Telegram bot, the roadmap in brief. Follows `DESIGN.md` §5.1 and the palette rule (black, white, faint white, orange). Built last as a separate page or app, so a landing outage never touches trading. Wording rule: "tokenized shares", never the underlying shares.

**Done when.** The apex domain serves the page; the redirect rule is removed; the app is unaffected; checked at 375, 768 and 1280 px and with reduced motion; the demo video and the README link to it.

## 3. Replayable on-site onboarding and tutorial

**Status:** not started

**Why.** New users meet tokenized stocks, issuers, multipliers and a minimum-shares guarantee at once. A short guided tour lowers the first-buy drop-off.

**Scope.** A first-run walk-through (skippable) that explains, in order: tokenized shares and share units; why one token is not one share; the guarantee and the minimum-shares line on a review; buying; migrating between issuers; Guardian alerts. It can be replayed at any time from the account menu and from the footer. Uses only real screens and clearly labelled sample numbers (never presented as live). Progress is remembered per browser (`localStorage`, with a safe fallback) and never blocks any action.

**Done when.** First visit shows the tour once; replay works from two places; it works with keyboard only and with reduced motion; it never shows on the blocked page or the receipt permalinks; usability check with at least two people who have never used the product.

## 4. Write the full version of How it works

**Status:** not started

**Why.** The docs page (`/docs`, anchor `#how`) has a short "How a buy works" and one placeholder anchor per concept (`apps/web/lib/concepts.ts`: shares, guarantee, slippage, premium, liquidity, not tradable, the unit trap, the fee, radar, portfolio). The "Learn more" links across the app end there.

**Scope.** A full, plain-language write-up: what a tokenized stock is and is not; the three issuers and how each represents shares (Ondo multiplier, bStock `uiMultiplier`, xStocks); the integrity grade and the Radar; how a guarded buy works, including the minimum shares floor and what a refusal means; selling and Migrate (two steps, why not atomic); the market-hours caveat for Ondo; Guardian, Pies and the agent layer; what Tally does not do. Every claim links to evidence in this repo or a transaction. It must never imply users own the underlying shares. The Developer Experience Report is separate and is written by the chief engineer, not by an AI.

**Done when.** Each concept anchor has real content; every "Learn more" lands on it; a non-crypto reader can follow a buy from the page alone (test with one person); numbers and examples are checked against `IDEAS.md` and live receipts.
