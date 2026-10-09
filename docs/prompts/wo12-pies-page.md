# WO-12 (Sonnet): the Pies page and the Portfolio suggestions

Work on your existing branch, fetch `main` first, no new branch, fixtures only (cloud session: never any secret). Palette rule (black, white, faint white, orange; no greys). Build from view models; do not call the engine and do not edit the buy, sell or ShareGuard code. Behind the existing flags. The nav already links `/pies` (flag `pies`); there is no page yet.

## 1. `/pies` page
Data: `PiesPageVM` from `apps/web/modules/pies/view-model.ts` (Agent 09, `docs/prompts/wo09-pies-mini.md`) and the run hook `apps/web/components/pies/use-pie-run.ts`. If either is not on `main` when you start, build against the typed shapes and fixtures and say so in the PR.
- List every basket (cards): name, one line, token chips (symbol, enabled or "Not enabled yet" with the reason), minimum budget.
- Choose a basket: a **budget** input with a slider (minimum from the VM, step $1) and a **weight per token** (typed percent or slider), with "Equal" reset; the weights must total 100% (show the total, normalise on request, disable Start otherwise). Live preview of each leg's USDT amount and approximate shares; legs under $6 shown as deferred with the reason; the unspent remainder.
- Start: a review sheet (list of legs, total, "Each stock is bought through the guarantee, one after another; you confirm each in your wallet"), then a progress list: each leg pending / signing / done (receipt link) / failed (plain reason) / not started. Stop at the first failure and show exactly what happened with a "Continue with the remaining legs" button; resume after a reload. A done state with a combined summary.
- Honest states: signed-out (Sign in), flag off (404), loading, empty, degraded, fixture ("Fixture data"). Roadmap strip: "Atomic baskets, auto-rebalancing and selling a basket: coming soon".
- 375 / 768 / 1280 and reduced motion; e2e with the mock wallet using the hook's fixture mode.

## 2. Portfolio suggestions
Data: `PortfolioVM.suggestions` (Agent 03, `docs/prompts/wo03-portfolio-suggestions.md`). Replace the blank state for any wallet that holds fewer than 3 stocks: a "Suggested for you" block under the holdings (or in place of the empty state) with the given number of cards (symbol, company, "Liquid" tag with its tooltip, one line "Enabled in Tally's guarantee and liquid right now. Not advice."), each with a Buy button that opens the Trade page for that ticker and issuer. Nothing shown when `state` is `none_needed`; when `unavailable`, a quiet line with the reason. The cards come only from the VM: never compute suggestions in the component.

## 3. Housekeeping
Make `e2e/radar-vm.spec.ts:70` ("cards load on demand") wait for the state it asserts instead of relying on timing (it fails under load because the scroll loader has already loaded everything when it checks for 48 cards).
