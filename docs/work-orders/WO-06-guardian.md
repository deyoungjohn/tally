# WO-06 Guardian alerts

| | |
|---|---|
| Agent | E (OpenCode) |
| Branch | `mod/WO-06-guardian` (slice A rules engine now; slice B delivery after WO-00) |
| Read first | `MODULES.md` §4.4, blueprint §13 (Telegram), `packages/core/src/status.ts`, `packages/core/src/multiplier.ts` (bounds), `IDEAS.md` F10–F11 |
| Fixtures | `packages/binance/fixtures/raw/probes_20261002T052602Z.json` (45 `paused`, 133 `UNSUPPORTED` Ondo tokens), `spike/results/module_probes_20261003T130122Z.json` (`G_*`, Ondo `offhours`, bStock `marketStatus: null`) |

## Owns

- `packages/mod-guardian/**`
- `apps/bot/**` (except `package.json` deps, which WO-00 adds)
- `apps/worker/src/jobs/guardian.ts`
- `apps/web/modules/guardian/**`, `apps/web/app/dev/guardian/**`
- Approved 2026-10-04, **additive only**: workspace dependencies `@tally/engine` and `@tally/core` (`workspace:*`) in `apps/bot/package.json` and the matching `pnpm-lock.yaml` importer lines, for the read-only commands (task 9). No external packages.
- Approved 2026-10-04, **additive only**: a read-only pause accessor in a new file `packages/engine/src/pause.ts` (+ `pause.test.ts`) and one accessor line in `packages/engine/src/engine.ts` (`engine.pauseState(tokenAddress): Promise<{ paused: boolean | null; reason: string | null; observedAt: number }>`). It calls the existing `TradeChain.readGuard(stock, router)` (router = the configured allow-listed router constant) and maps `tokenPaused` true/false, and `undefined` (the check reverted, which fails closed on-chain) or a token ShareGuard is not configured for to `paused: null` with a reason. No change to `trade.ts`, ShareGuard or the buy path. Guardian's worker awaits it once per holding per run and passes the result as `isPausedOnchain` (never defaulting unknown to false). Pause alerts therefore cover assets configured in ShareGuard; say so in the PR. The WO-05 PR also adds one accessor line to `engine.ts`: expect a trivial rebase conflict.
- Reassigned 2026-10-04 from agent E to agent D (Antigravity). Slices ship as separate PRs on the same branch name `mod/WO-06-guardian` (slice B starts fresh from main after slice A merges).
- `apps/web/lib/server/session.ts`
- `apps/web/lib/server/session.test.ts`
- `apps/web/app/api/session/**`

## Tasks

**Slice A (pure):**
1. `Rule` interface: `evaluate(prev: State, next: State, holding): Alert[]`; rules: paused/halted (Ondo status; bStock via an injected `isPaused(token)` port), share-count changed (multiplier observation delta, explained: dividend/split/unknown), grade dropped (from Radar snapshot), no exit (ghost), per-share price threshold (regular session only).
2. Alert = `{ id, rule, ticker, issuer, severity, title, body, evidence: { snapshotKind, snapshotKey, observedAt }, createdAt }`; plain-English copy, facts only (no "you should").
3. De-duplication (same rule + token within cooldown), quiet hours, per-user settings type.
4. Tests from the fixtures: a token going `TRADING` → `MARKET_PAUSED` emits one alert; repeated polls don't re-alert; bStock with `null` status emits nothing from status (only from the pause port).

**Slice B (after WO-00):**
5. Worker job `guardian`: evaluate holdings of subscribed users each minute from snapshots; write alerts to the store.
6. Telegram (grammY, long polling): `/start` link flow (one-time code shown in the web app), `/alerts on|off`, `/quiet 22-07`, delivery of alerts. Bot token from env `TELEGRAM_BOT_TOKEN` only.
7. View models (UI split: you ship the logic and a typed view model plus a plain, unstyled component in `apps/web/modules/<name>/`; the UI agent (WO-12, Sonnet) builds the real page from your view model. Don't style, don't create pages outside `apps/web/app/dev/<name>/`.): `AlertFeedVM` and `GuardianSettingsVM` (rules, thresholds, quiet hours, Telegram link state). The UI agent builds the Guardian page.
8. Earnings rule: only if the orchestrator confirms a source (gate V-E); otherwise leave a disabled rule stub with a reason.
9. **Read-only bot commands (restored from blueprint M6, §13)**, answered from snapshots and `@tally/engine` only (no keys held, nothing signed):
   - `/quote <TICKER> [usd]` → issuer comparison in shares (price per share, premium vs US, fee, grade, `best`), same numbers as the web app.
   - `/shares <address>` → holdings in shares per ticker across issuers (`null` + reason when a multiplier is unknown, never 1:1).
   - `/shield` → tokens currently flagged (paused, ghost, unit mismatch, stale data) with plain-English reasons.
   Replies within 3 s from cached snapshots; when data is stale, say how old it is.

## Exit checks

- [ ] Slice A tests above.
- [ ] Telegram down (mocked) → alerts still written and visible on the web feed; error in health.
- [ ] One rule throws → other rules still evaluate (test).
- [ ] View-model tests: empty feed, de-duplicated feed, Telegram not linked.
- [ ] Command tests (fixture mode): `/quote NVDA 25` shows both issuers in shares; `/shares` on the burner wallet; `/shield` lists a paused and a ghost token; stale snapshot → age shown.

## Out of scope

Any automatic action (WO-08).

## Session verification (follow-up, 2026-10-06)

Approved additive: new `apps/web/lib/server/session.ts`, `apps/web/app/api/session/**` (Guardian feed, settings and link-code routes; `active-wallet` registration for the statement worker) and one dependency, `@privy-io/node`, in `apps/web`. The app has no other server-side proof of which wallet a browser owns, so Guardian's per-wallet data and the Telegram link must only use an address the server verified from Privy's own user record. `PRIVY_APP_SECRET` lives only in `/etc/tally/tally.env`. The client side (sending the access token) belongs to WO-12. Full instructions: `docs/prompts/wo06-privy-session.md`.

