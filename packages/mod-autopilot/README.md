# Guardian Autopilot — Slices A and A2

Flag off by default. This slice records shadow decisions only. There is no execution
port, subprocess, signing, transaction, Switch action or recurring
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

## Shadow worker and position collector

The filename loader registers `apps/worker/src/jobs/autopilot.ts`. It refreshes opt-in positions and reads
`alerts/<lowercase wallet>` arrays, and remains inactive unless
`FEATURE_AUTOPILOT=1`. Its interval is 60s and runner timeout is 30s. Start only
**one Autopilot writer process per store**, as with the module's single worker
loop. The generic SnapshotStore API has no cross-process compare-and-insert lock.

Input contracts (A2 adds their producers):

- `autopilot-policy/<lowercase wallet>`: `PolicySettings`; 24h TTL. Missing or stale
  settings unarm the rules and warn. Functions are never stored.
- `autopilot-position/<lowercase wallet>:<lowercase token>`: `Position`; 60s TTL.
  A collector must normalize chain balance, token decimals, accepted issuer
  multiplier, share price in E18, grade and continuous pause start with observation
  time. `balanceSource` must be `chain`. These facts must not be fabricated from
  Binance's displayed wallet balance. Existing API-derived `portfolio` snapshots
  are deliberately not used for sizing. Missing facts produce reasoned shadow
  refusals and warnings. A2 collects these inside the existing Autopilot job; no other collector is changed.
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

## A2 producers and session contract

At the start of the existing job, only wallets with a current stored policy are
collected (at most 20 wallets, 10 allow-listed tokens each; truncation warns).
`engine.sharesOf` provides the raw **chain** balance and accepted multiplier;
shares are calculated with bigint. Registry metadata decimals are accepted only
when exactly 18; otherwise decimals and shares are null, a warning is emitted,
and `decide` refuses with `unknown token decimals`. No new engine accessor or
dependency is introduced. Integrity grades come from `engine.facts`; pause comes
from `engine.pauseState`. Prices use the fresh prices snapshot reference divided
by the registry's recorded token-to-share ratio; a registry reference fallback
warns. Missing references, ratios, balances or multipliers remain null.

Continuous pause starts are `autopilot-pause/<token>` snapshots: the first paused
reading sets the start, an unpaused reading clears it, and unknown readings leave
it alone. `autopilot-collector/<wallet>` records the last completed collection's
position keys, distinguishing never collected from empty. Reads and snapshots
are staged under the runner's existing 30s cancellation signal. A token read
failure warns and skips just that token; unavailable registry or all-token failure
throws before shadow evaluation. Cancellation commits no late results. A store
failure during position persistence may leave partial input snapshots, but the
append-only decision log stays unchanged and failed worker health is visible.

`GET /api/session/autopilot/policy` returns the latest policy, ceilings/defaults,
positions and their age, collector status, and the additive `AutopilotVM`.
`PUT /api/session/autopilot/policy` accepts decimal USD strings (at most 18 decimal
places), rejects caps outside $6–$100 per trade / $6–$250 per day, validates the
three rule IDs and bounds, and accepts only up to 10 registry-listed executable
Ondo/bStock tokens. Unknown fields, xStocks and unknown addresses are rejected.
Missing kill switch defaults to **on**, and unset policy is also safe by default.
Both methods are dynamic, default-off behind the existing flag, rate-limited by
IP and verified wallet, and use `verifiedWallet(req, x-tally-wallet)` only; query,
cookie and body addresses never authorize a wallet. Policy writes are limited to
20 per hour for that verified wallet. All saved policies are new snapshots with
source `web-session`; the latest row is used even for saves in the same millisecond.
`autopilot-policy` is not an evidence kind and may be pruned by retention, so old
policy revisions are not a guaranteed permanent audit trail; decision rows retain
the policy used for each decision.

API `PolicySettings`/position bigints are serialized as E18 integer strings. The
optional VM `policy`, `positions` and existing `caps` display decimal strings;
`policyEditable` is true only when the loader has explicit verified-session proof.
`collector` has `never collected | empty | stale | ok` plus age. The plain form
uses the existing session-fetch hook. A separate panel in the dev preview loads
verified-session observations on demand; constructed data remains explicitly
labelled and uneditable. No polling, signing or execution is added. The UI agent
can reuse this panel or consume GET's VM for its own screen.

Tests cover spoofing, validation and both rate limiters, append-only policy saves,
collector 10:1/1:1 arithmetic, null decimals/multiplier/grade/price, continuous pause,
opt-in bounds, one-token and whole-source failures, actual 30s runner cancellation,
and stored policy → collected position → shadow-only decision. Preview Playwright
checks the form/session save path without a transaction as well as all six viewport
and reduced-motion captures.

## User-run verification

Deployment and worker setup are described only in [docs/deployment.md](../../docs/deployment.md).
With the deployed app and existing workers ready, sign in to your wallet, open the
flag-gated `/dev/autopilot` preview, and click **Load verified shadow observations**.
In its separate verified-session section, save an allowed registry token and a
rule with the kill switch off, caps $6 or higher within the ceilings. Wait a minute,
then click **Load verified shadow observations** again. Positions should show
chain-derived shares, USD, grade, pause and age. If Guardian has emitted a fresh
matching alert, its row should say `mode: shadow` and **would have sold; nothing was
executed** (or explain its refusal); `spentToday` remains zero. Quiet wallets do
not fabricate alerts. The preview section above remains constructed data.
Session stop rules still refuse `session unknown`, because no regular-session
provider is wired; pause alerts still need a fresh matching alert after the
configured continuous duration. No live command or money path is part of A2.
