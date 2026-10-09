# WO-01 M3 follow-up

| | |
|---|---|
| Agent | D (Antigravity), reassigned from A on 2026-10-04 to save Sonnet's quota for UI. D also holds WO-06 in parallel (user decision): separate worktrees and branches. Backup: A. Hand over the same branch, never two agents on one WO. |
| Branch | `mod/WO-01-m3-followup` — fresh branch from latest `origin/main`, not the merged M3 branch |
| Priority | **Urgent, critical path.** Merge as soon as possible; target no later than Tue 6 Oct. WO-02 slice B cannot start until `onStage` is merged. |
| Read first | `AGENTS.md`, `CLAUDE.md`, `MODULES.md` §1–§3, blueprint §7.6, `DESIGN.md`, WO-02 receipt types and slice B requirements |

## Merged base — done

The M3 base from `claude/m3-web-trade-flow` is on main via PR #6 (merge `45ab557`). The ticker/trade UI, Privy sign-in, top-up, plan/approval/re-quote/simulation/sign/receipt flow and error copy are already implemented. Do not rebuild them. This records the merged implementation, not proof that every user-run live check passed.

One task remains: typed stage events. (The landing page lead moved to WO-12 on 2026-10-04.) The document path is retained so existing references still resolve.

## Owns

- Approved 2026-10-09 by the chief engineer, **route selection for buys only** (`docs/prompts/wo01-buy-rfq-routes.md`): the new `packages/engine/src/route-choice.ts` (extracted from `packages/engine/src/sell.ts`), `packages/engine/src/route-choice.test.ts`, the route pick in `packages/engine/src/trade.ts` (`prepare`), `packages/engine/src/trade.test.ts`, the matching route pick in `packages/binance/src/adapters.ts` (consistency of the displayed quote). ShareGuard, every contract file, the floor and multiplier logic, `use-trade-flow.ts` and receipts stay off limits.
- `docs/work-orders/WO-01-m3-trade.md`
- Approved 2026-10-08 (`docs/prompts/wo01-wallet-identity.md`): `apps/web/components/wallet/**` (wallet choice, logout) and their tests; `apps/web/components/site-header.tsx` (account menu label only); in `apps/web/components/trade/use-sell-flow.ts` and `apps/web/components/trade/use-sell-flow.test.ts` only the wallet binding of `tally.pendingSell`; the data hooks' cache reset on a user change (`apps/web/lib/hooks/use-json*` and its test).
Approved 2026-10-04 by the chief engineer, limited to the stage-event task:

- `apps/web/components/trade/use-trade-flow.ts` — additive optional `onStage` integration only; preserve existing transaction behavior.
- `apps/web/components/trade/trade-stages.ts`, `apps/web/components/trade/trade-stages.test.ts`, `apps/web/components/trade/use-trade-flow.test.ts` — new typed event contract, helpers and unit tests.
- `apps/web/e2e/trade.spec.ts` — event regression evidence only.
- Approved 2026-10-04, **test-only, additive**: the WO-04 follow-up may add two `await expect(review).toBeFocused()` waits to the keyboard-path test in `apps/web/e2e/trade.spec.ts` (flake fix: Esc/Tab pressed before the dialog's focus effect ran). No other change. WO-01 rebases; expect a trivial conflict at most.

These files are reserved for WO-01 until it merges; WO-12 resumes ownership afterward. Landing files (`apps/web/app/page.tsx`, `apps/web/components/home/**`, `apps/web/e2e/home.spec.ts`) belong to WO-12 now. No dependencies approved. If truthful receipt-stage data requires additional engine, DTO or API files, stop and propose the exact additive paths to the orchestrator before editing them.

## Tasks

1. **Typed `onStage(stage, payload)` events.** Expose intent, quote, simulation, signed and realized from the existing flow so WO-02 slice B can subscribe without editing the producer. Document the subscription entry point and payload contract in the PR. Preserve share/token amounts as bigint or lossless integer strings, correlate events to the same intent/transaction, and retain the observed conversion and provenance available from the plan. Emit simulation evidence only when actually available; missing evidence has a reason, never an invented output. Keep re-quotes and resumed receipts identifiable. An absent subscriber preserves current behavior; a subscriber failure warns and must not alter approval, confirmation or transaction execution. Receipt persistence and reconciliation stay in WO-02.

## Exit checks

- [ ] Unit tests prove all five typed stages, their order and correlation, re-quote handling, resumed receipt handling, and honest missing simulation evidence.
- [ ] No subscriber and a failing subscriber leave the existing buy behavior intact; failures warn, with tests.
- [ ] WO-02 can consume the exported contract and subscription entry point without modifying WO-01 files; PR documents the handoff.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm e2e` and `pnpm e2e:foundation` pass; full review pack includes existing landing, region-gate and trade regressions (unchanged by this WO).
- [ ] Only owned paths changed; no changes to ShareGuard, transaction construction, signing policy, gas, allowance, simulation gates or buy execution semantics.

## Out of scope

Rebuilding M3, wallet/provider changes, engine or API rewiring, sell/switch, receipts storage, new module screens and new dependencies. User-run live checks remain the chief engineer's; do not send transactions.
