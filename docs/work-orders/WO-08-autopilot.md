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
- WO-13 Move, hosted on this branch (no new branch): `apps/web/modules/switch/**`, `apps/web/app/dev/switch/**`, `apps/web/lib/move/**`, `apps/web/components/trade/use-move-flow.ts`, `apps/web/components/trade/move-sheet.tsx`, `apps/web/e2e/move.spec.ts`; additive hunks in `apps/web/components/portfolio/portfolio.tsx` and `apps/web/components/trade/trade-client.tsx`. Spec: `docs/work-orders/WO-13-move.md`.
- `packages/modkit/src/index.ts` (the `prune` function only) and `packages/modkit/src/index.test.ts` (the one evidence-protection test only). Approved 2026-10-06, tightening only: see the approval at the end of this file.

## Tasks

1. Policy (pure): armed rules (pause > X h, grade ≤ D, per-share stop in regular session), allowed actions (sell to USDT, switch issuer), per-trade cap, daily cap, token allow-list, kill switch. `decide(alert, policy, spentToday): Decision` returning `execute | alertOnly` with reasons.
2. Append-only decision log (store kind `decision`): inputs, rule, decision, reasons, receipt id when executed.
3. Executor: via `baw` (Agentic Wallet CLI) in a subprocess with a timeout; sell = API transaction, switch = ShareGuard call; then hand to Receipts. Any failure, cap or missing capability → downgrade to an alert. Never retry automatically.
4. If gate V-AW says `baw` has no spend caps / session policy on BSC: ship "one-tap approve from the alert" instead, and say so in the UI.
5. Use the Wallet Skill and MCP tools from WO-05 (`skills/share-true-trading/`, `packages/mcp`) for execution; don't duplicate them. Add autopilot-specific instructions only via a PR comment to WO-05's owner if needed.
6. View model (UI split: you ship the logic and a typed view model plus a plain, unstyled component in `apps/web/modules/<name>/`; the UI agent (WO-12, Sonnet) builds the real page from your view model. Don't style, don't create pages outside `apps/web/app/dev/<name>/`.): `AutopilotVM` (armed rules, caps, spent today, kill switch, decision log rows).

## Exit checks

- [ ] `decide` tests: cap reached, kill switch on, outside regular session, token not allowed, all → `alertOnly` with the right reason.
- [ ] Executor with `baw` mocked to fail → alert, no retry, decision logged.
- [ ] User-run: one armed rule fires on a $6 position and executes within caps (commands in the PR).

## Out of scope

Custody of keys, any server-held signing key.

## Wave 3 scope (2026-10-06, after gate V-AW passed live)

Gate V-AW passed: a real unattended sell executed through `baw` with no app tap (`docs/evidence/V-AW-live-sell.md`), but Binance's lowest daily limits are $1,000 (so the wallet cap is a backstop and Tally's own caps are the rail). **Slice A (now):** `decide`, the append-only decision log, a shadow-mode worker job and `AutopilotVM`, flag-off, no `baw`, no money path. **Slice B (only on the orchestrator's go):** the executor with an injected `BawPort`, mocked in tests, live only in a user-run script. Sell to USDT is the only action (Switch is cancelled). Full instructions: `docs/prompts/wo08-autopilot.md`. Task 4 above (one-tap approve fallback) now means: if `requireConfirmation` is true the decision downgrades to an alert.

Decision 2026-10-06 (chief engineer): `baw` may run on the EC2 for Slice B. Conditions: the chief engineer signs in to the Agentic Wallet on the server (nobody else); Binance signs the session out after 48 h of inactivity and at `sessionExpireTime`, so the executor checks `baw wallet status` is `CONNECTED` before every attempt and otherwise downgrades to an alert; the executor may only run the fixed subcommands `wallet status|settings|left-quota` and `contract-call preview|execute`, with a scrubbed environment and a timeout; run `baw` as a dedicated unix user, not the one that reads the Ondo feed-signer key. **Limit to state in the README and UI:** the `baw` wallet is the chief engineer's own wallet, so autopilot works for that wallet only; any other user would need their own Agentic Wallet.

Approved 2026-10-06 (Agent 08's finding), tightening only: in `packages/modkit/src/index.ts`, `SnapshotStore.prune` must always exclude `EVIDENCE_SNAPSHOT_KINDS`; the `excludeKinds` argument can only add kinds to that list, never remove them (so `excludeKinds: []` no longer lets `receipt`, `decision` or `alert` rows be deleted). Change that one function, and in `packages/modkit/src/index.test.ts` update only the test "protects receipt, decision and alert evidence by default…": its last two lines currently expect `excludeKinds: []` to delete a `receipt` row, so replace them with assertions that evidence survives `excludeKinds: []`, that an extra non-evidence kind passed in `excludeKinds` is also kept, and that an unprotected kind is still pruned. No other modkit change. `expire` already refuses protected kinds; keep it. Nothing in the repo passes `excludeKinds` today.

