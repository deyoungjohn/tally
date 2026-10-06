# Guardian Autopilot — Slice A

Flag off by default. This slice records shadow decisions only. There is no execution
port, subprocess, network call, signing, transaction, Switch action or recurring
trade implementation. `decision: "execute"` means an eligible hypothetical sale to
USDT; shadow rows say **would have sold; nothing was executed**.

Binance's own daily limit is $1,000 and is only a backstop; these caps are enforced by Tally.
The live evidence in `docs/evidence/V-AW-live-sell.md` established an unattended sale,
not a refusal at the wallet cap. Default Tally caps are $25 per trade / $50 per UTC
day, clamped in code to $100 / $250. Autopilot's minimum is **6 USDT**, even though
the manual sell path uses a different minimum. The wallet is the chief engineer's
own Agentic Wallet; other users would need their own Agentic Wallet. Slice B has
not started.

## Pure contract

`decide(alert, policy, state, now)` takes explicit typed inputs. USD, shares and
shares-per-token multipliers use bigint E18 units from `@tally/core`; token amounts
use the asset's own decimals. The exact Guardian rule IDs are `paused`, `grade-drop`
and `price-threshold`. Other Guardian rules are not executable.

A pause must last strictly longer than the armed threshold; an integrity grade
must be D or F at the configured threshold; a stop must be a downward price alert
at or below the user's per-share stop. A stop also requires an injected regular
session check; absent or unknown checks refuse with `session unknown`. No calendar
or timezone heuristic is inferred. Unset policy has no armed rules or allowed tokens.

The allow-list contains token contract addresses, not tickers. Wallet, address,
ticker and issuer must match the position. Alerts and their evidence have a 60s
freshness ceiling, as do sizing facts. Future observations refuse. The budget is
`min(position USD, effective per-trade cap, remaining daily cap)`. All conversions
floor, and the final token amount is bounded by the **chain** balance. Unknown
shares or multiplier never become 1:1. Rounding below 6 USDT refuses.

## Snapshot-only shell

The filename loader registers `apps/worker/src/jobs/autopilot.ts`. It reads
`alerts/<lowercase wallet>` arrays, and remains inactive unless
`FEATURE_AUTOPILOT=1`. Its interval is 60s and runner timeout is 30s. Start only
**one Autopilot writer process per store**, as with the module's single worker
loop. The generic SnapshotStore API has no cross-process compare-and-insert lock.

Input contracts (no producer or configuration UI is added in this slice):

- `autopilot-policy/<lowercase wallet>`: `PolicySettings`; 24h TTL. Missing or stale
  settings unarm the rules and warn. Functions are never stored.
- `autopilot-position/<lowercase wallet>:<lowercase token>`: `Position`; 60s TTL.
  A collector must normalize chain balance, token decimals, accepted issuer
  multiplier, share price in E18, grade and continuous pause start with observation
  time. `balanceSource` must be `chain`. These facts must not be fabricated from
  Binance's displayed wallet balance. Existing API-derived `portfolio` snapshots
  are deliberately not used for sizing. Missing facts produce reasoned shadow
  refusals and warnings; no collector outside this work order was changed.
- The standalone shadow adapter accepts an injected `isRegularSession`. The worker
  has no session provider in Slice A, so session rules remain alert-only there.

Each run stages all new `DecisionRow`s before writing one `DecisionBatch` under
protected kind `decision`, key `autopilot`. A batch contains **one logical row per
alert**, including inputs, rule, decision, reasons, leg, shadow/live mode and any
receipt evidence. The single SQLite insertion commits the run atomically; primary
read, evaluation, cancellation and commit failures leave the old log intact. An
empty run writes nothing. Reads flatten the entire protected batch history without
a latest-row/list-window truncation. Already-recorded IDs are skipped; duplicate
IDs in a log fail closed. Rows are never rewritten. The approved modkit change
makes protected evidence immune to even `prune({ excludeKinds: [] })`; callers
can only add exclusions. `expire` still rejects evidence.

`spentToday` is derived afresh from actual, receipt-backed live executions using
`executedAt` in the current UTC day and `executedUsd`; proposed budgets and shadow
rows spend zero. Execution evidence types support accounting tests only; there is
no executor. Invalid actual execution evidence fails closed.

## UI contract and local evidence

`loadAutopilot` exposes `AutopilotVM`: armed rules, allow-list, effective caps and
ceilings, kill switch, spend, decision rows, fixed banner, source/age and
`ready | empty | stale | error`. Supply a **verified session wallet address**.
Loads warn on errors; failed health retains the last good rows. With worker health,
quiet logs do not falsely become stale merely because no new alerts fired.

`AutopilotPlain` uses ModuleBoundary with an unstyled renderer. `/dev/autopilot`
requires the feature flag and, in production, `TALLY_DEV_PREVIEWS=1`. It renders an
explicitly labelled constructed fixture, including a stale shadow row. A preview
fallback displays only that supplied fixture when there is no worker health.

Offline checks:

```bash
pnpm --filter @tally/mod-autopilot test
pnpm --filter @tally/modkit test
pnpm --filter @tally/web exec vitest run modules/autopilot/view-model.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @tally/web exec playwright test --config modules/autopilot/playwright.config.ts
FULL=1 bash scripts/review-pack.sh mod/WO-08-autopilot
```

The preview specs capture 375/768/1280px in ordinary and reduced motion, assert
no horizontal overflow, and verify the banner, stale age, zero spend and shadow
label. Job tests invoke the actual worker with a trap engine, primary-source
failure after one staged row, a commit failure, and late work after runner timeout.

## User live commands

None for Slice A. All checks use constructed data, an in-memory SnapshotStore or
recorded fixture-mode engines. No money path or live script is present. The
executor and all real wallet operations remain gated on a separate Slice B go.
