# WO-06 follow-up: Guardian settings write route (prompt for Agent 06, 2026-10-07)

You are Agent 06 (Antigravity). Keep working in your existing worktree on your existing branch `mod/WO-06-guardian` (its tip is merged, so it is only behind). Do **not** create a new branch. First `git fetch origin && git merge --ff-only origin/main` and confirm `git status` is clean. Read `docs/work-orders/WO-06-guardian.md`, `packages/mod-guardian/src/types.ts` (`GuardianSettings`, `DEFAULT_GUARDIAN_SETTINGS`), `apps/web/modules/guardian/view-model.ts` (`loadGuardianSettings`, which reads the store kind `guardian-settings`), `apps/web/app/api/session/guardian/settings/route.ts` and `apps/web/lib/server/session.ts` (merged; do not edit). You never push to main, merge or run anything live. **Never create, request, print or store keys, seed phrases, RPC URLs or secrets.**

## Why
The Guardian screen shows the rules and quiet hours read-only ("Changing these here isn't available yet") because nothing accepts a change. Add the write path so the UI can turn them into switches.

## Owns (additive; nothing else)
The existing `apps/web/app/api/session/guardian/settings/route.ts` (add `PUT`), a validator and saver in `packages/mod-guardian/src/settings.ts` (new, with tests), the matching export in `packages/mod-guardian/src/index.ts`, and `apps/web/modules/guardian/view-model.ts` (optional fields only). No other file.

## 1. `PUT /api/session/guardian/settings`
- Wallet **only** from `verifiedWallet(req, x-tally-wallet)`; never from the query, cookie or body. 401 `session_required` without it; flag `guardian` off is 404; per-IP limit and 30 saves per hour per user (`rateLimitedUser`).
- Validate the whole body with zod and **reject unknown fields**. Accept exactly a `GuardianSettings`: `enabled` boolean; `rules` with the six booleans (`paused`, `shareCount`, `gradeDrop`, `ghost`, `priceThreshold`, `earnings`); optional `priceThresholds` keyed by ticker (at most 20 tickers, each ticker must be a registry ticker, `minPriceUsd` and `maxPriceUsd` positive finite numbers, and `minPriceUsd < maxPriceUsd` when both are set); optional `quietHours` (`enabled` boolean, `startHourUtc` and `endHourUtc` integers 0 to 23); optional `cooldownMs` integer between 900,000 (15 minutes) and 604,800,000 (7 days).
- `earnings: true` is **rejected** with the reason "No earnings-date source is available yet" (the earnings rule is a disabled stub); `false` is accepted.
- Store the new settings as a new `guardian-settings` snapshot keyed by the lowercase wallet (`source: "web-session"`), so the existing loader and the Guardian worker read it unchanged. Confirm in a test that the worker actually honours a saved rule toggle, quiet hours and cooldown.
- Return the refreshed `GuardianSettingsVM` (same shape as `GET`). On a validation error return 400 with the list of field-level reasons in plain words.

## 2. Optional extra (small): a "module is behind" flag
The session routes return the view model directly, so the page cannot say "Guardian is behind" apart from "your last alert is old". Add optional `moduleDegraded: boolean` and `moduleReason: string | null` to `AlertFeedVM` and `GuardianSettingsVM`, filled **in the routes** from the module health the other pages already read (`readModuleHealth()` in `components/module-boundary`), not inside the loaders, so the loaders stay pure. If this needs anything beyond reading that function, skip it and say so in the PR.

## Tests
Spoof test (address in query, cookie and body ignored; unverified is 401), flag off 404, unknown field rejected, `earnings: true` rejected, bad thresholds and hours rejected, cooldown bounds, rate limit trips, a saved setting is returned by `GET` and read by the worker, each save adds a snapshot (history kept), no secret or address is logged.

## Done means
`pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`, `pnpm build && pnpm e2e`, `FULL=1 bash scripts/review-pack.sh mod/WO-06-guardian` green, a PR listing every changed file, and the request and response shape for the UI agent. Target: review-ready **Thursday 8 Oct, 09:00 UTC**. If anything is ambiguous, stop and ask; don't guess.
