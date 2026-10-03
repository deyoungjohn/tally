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

## Exit checks

- [ ] Slice A tests above.
- [ ] Telegram down (mocked) → alerts still written and visible on the web feed; error in health.
- [ ] One rule throws → other rules still evaluate (test).
- [ ] View-model tests: empty feed, de-duplicated feed, Telegram not linked.

## Out of scope

Any automatic action (WO-08).
