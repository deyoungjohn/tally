# WO-08 Guardian autopilot

| | |
|---|---|
| Agent | C (Codex #2), after WO-02 and WO-06 |
| Branch | `mod/WO-08-autopilot` |
| Read first | `MODULES.md` §4.6, blueprint §12 (Agent layer / Wallet Skill), Binance Agentic Wallet docs (skills reference), gate V-AW answer |

## Owns

- `packages/mod-autopilot/**`
- `apps/worker/src/jobs/autopilot.ts`
- `apps/web/modules/autopilot/**`, `apps/web/app/dev/autopilot/**`
- `skills/share-true-trading/**` (Wallet Skill, blueprint §12)

## Tasks

1. Policy (pure): armed rules (pause > X h, grade ≤ D, per-share stop in regular session), allowed actions (sell to USDT, switch issuer), per-trade cap, daily cap, token allow-list, kill switch. `decide(alert, policy, spentToday): Decision` returning `execute | alertOnly` with reasons.
2. Append-only decision log (store kind `decision`): inputs, rule, decision, reasons, receipt id when executed.
3. Executor: via `baw` (Agentic Wallet CLI) in a subprocess with a timeout; sell = API transaction, switch = ShareGuard call; then hand to Receipts. Any failure, cap or missing capability → downgrade to an alert. Never retry automatically.
4. If gate V-AW says `baw` has no spend caps / session policy on BSC: ship "one-tap approve from the alert" instead, and say so in the UI.
5. Wallet Skill doc per blueprint §12, including Tally's multiplier rules and the 6 USDT minimum.
6. View model (UI split: you ship the logic and a typed view model plus a plain, unstyled component in `apps/web/modules/<name>/`; the UI agent (WO-12, Sonnet) builds the real page from your view model. Don't style, don't create pages outside `apps/web/app/dev/<name>/`.): `AutopilotVM` (armed rules, caps, spent today, kill switch, decision log rows).

## Exit checks

- [ ] `decide` tests: cap reached, kill switch on, outside regular session, token not allowed, all → `alertOnly` with the right reason.
- [ ] Executor with `baw` mocked to fail → alert, no retry, decision logged.
- [ ] User-run: one armed rule fires on a $6 position and executes within caps (commands in the PR).

## Out of scope

Custody of keys, any server-held signing key.
