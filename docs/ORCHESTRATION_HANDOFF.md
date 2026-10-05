# Orchestration handoff (Claude → GPT-6 Astra)

Written 2026-10-04 by Claude (chief orchestrator) for **GPT-6 Astra**, who takes over day-to-day orchestration until the final reviews.

## 0. Roles from now on

| Who | Role |
|---|---|
| **The user (Young John)** | Chief engineer. Reviews after you, squash-merges, owns every key and deployment, runs everything live (trades, recorders, `baw`, EC2). Final say on everything. |
| **Astra (you)** | Day-to-day orchestrator: review PRs from review packs, answer agents' scope questions, approve small additive scope expansions, keep work orders, the calendar and this file current, answer the user's questions. |
| **Claude** | Still chief orchestrator, but on a limited quota (resets Fridays). Does **only** the escalations in §9 and the final review before submission. Don't spend Claude on routine work. |
| **Agents A–F** | Build one work order each on their own branch (see `docs/work-orders/README.md`). They never merge, deploy, send transactions or touch secrets. |

## 1. Read these first (in order)

1. This file.
2. `AGENTS.md`: the rules every agent follows. You enforce them.
3. `CLAUDE.md`: project rules (security, units, style). Applies to you too.
4. `MODULES.md` (v2): positioning, module catalogue, §3 architecture rules, §4 specs, §5 open gates, §6 DX-report notes.
5. `docs/work-orders/README.md`: team, calendar, review protocol, dispatch prompt, index. Then each `WO-xx-*.md`.
6. The written reviews in `review/<branch>/REVIEW.md` (WO-00, WO-02, WO-03; all three now merged): copy their tone, structure and strictness.
7. As needed: `TALLY_BLUEPRINT.md` (§7 engine, §12 agent layer, §13 Telegram, §17 milestones), `DESIGN.md`, `IDEAS.md`, `contracts/README.md`.

## 2. The project in one paragraph

**Tally** is a "share-true" layer for tokenized US stocks on BNB Chain (Ondo, bStock, xStocks), built for the **BNB Hack: Tokenized Stocks Edition**. Every number is shown in **real shares**, not tokens (Ondo NFLX = 10 shares per token; bStock 1:1 via on-chain `uiMultiplier`; xStocks display-only), and every buy goes through **ShareGuard v1** (`0x28F6F19bffbF25E36452c78d12090F0bC922970a`, BSC mainnet), which enforces a minimum in shares. The moat is share-true data and evidence (receipts, statements, flow, alerts), **not** routing. We deliberately avoid two crowded spaces: a "better swap screen"/router and weekend-gap/fair-value pricing. Quote comparison is an internal library, not the pitch.

## 3. Environment facts

- **Repo:** GitHub, default branch `main`. Windows clone: `C:\Users\DELL\Projects\tally` (this is the folder you edit; Claude also reads it). WSL worktrees per agent: `~/Projects/tally-wo00`, `~/Projects/tally-wo02`, `~/Projects/tally-wo03` (more get added per work order). Sonnet (agent A) works in a Claude Code **cloud** session on the fresh `mod/WO-01-m3-followup` branch after the M3 base merged.
- **Stack:** pnpm monorepo, Node 22, Next 16, viem, Foundry, Privy, Vitest, Playwright. Packages: `core`, `binance`, `chain`, `engine`, `modkit` (WO-00), `mod-*`, `mcp`. Apps: `web`, `worker`, `bot`.
- **Windows Codex tooling:** use `corepack pnpm` to honor `package.json`'s pinned pnpm 10.28.0. The bundled fallback `pnpm` launcher used 11.19.0 and failed installation with `ERR_PNPM_IGNORED_BUILDS` on 2026-10-04. Do not approve every dependency script or change the repo's package-manager version to accommodate that launcher. `.prettierignore` intentionally excludes Markdown (`*.md`), present since M0; `format:check` does not validate these orchestration docs. Verified: pinned install succeeds (dependency scripts remain blocked with warnings), core tests 116/116 pass. This Windows checkout has `core.autocrlf=true`: the normal format check flags CRLF; `node node_modules/prettier/bin/prettier.cjs --check . --end-of-line auto` passes without rewriting files.
- **Binance Web3 API:** refuses US callers (`40304`). The user is in Nigeria (allowed); deployment is a Seoul EC2. Cloud agents (US) must build against **fixtures**: `packages/binance/fixtures/raw/` and `spike/results/module_probes_*.json` (newest full set: `module_probes_20261003T130122Z.json`).
- **RPC:** the engine reads `BSC_RPC_PRIMARY` (NodeReal) and `BSC_RPC_FALLBACKS` (Ankr), confirmed by the user on 2026-10-04. Recorder-specific environment names may differ. `.env` overrides the OS environment (a stray Windows `BSC_RPC_URL` used to win). The public RPC refuses `eth_getLogs`; NodeReal handles 10,000 blocks per call (~75 min).
- **Review packs** live in `review/<branch_with_underscores>/` in the Windows clone. `review/` is **git-ignored**: read it from the local folder, not GitHub.
- The user's Cowork bridge to Claude can only copy files (no shell). If Claude must review, the user runs the pack first and Claude reads `review/`.

## 4. Status (as of 2026-10-04)

| WO | Module | Agent | Status | Next action |
|---|---|---|---|---|
| 00 | Foundation (modkit, worker, flags, health, ModuleBoundary) | B Codex #1 | **Merged** | none |
| 01 | M3 follow-up (`onStage` events only; landing lead moved to WO-12) | D Antigravity (also holds WO-06) | **APPROVE** (money-path check done, no change) | User squash-merges; then WO-02 slice B starts. |
| 02 | Receipts + Quality | C Codex #2 | **Slice A merged.** Slice B pending WO-01 | After WO-01 merges: dispatch slice B on the same branch name `mod/WO-02-receipts` (fresh from main; user decision 2026-10-04). Notes 2–3 in its REVIEW.md apply. |
| 03 | Portfolio + Statement | D Antigravity | **Merged** (PR #7, `a732de4`; fixes 8–10 in `af9bac6`) | none. Collectors stay additive; WO-04 rebases over `collectors.ts`. |
| 04 | Flow + Radar | B Codex #1 | **Merged** (PR #8, `0032642`). Follow-up (worker pace `TALLY_WORKER_RPS`, clean shutdown) at 866c2bd: **APPROVE after one small fix** (onWarn default, review addendum) | User squash-merges the follow-up after the fix. Then flag-on gate is met on the code side; optional EC2 re-run. Ghost wiring into core still NOT applied. |
| 05 | Agent layer: MCP, Wallet Skill, upstream PR | B Codex #1 | **APPROVE** @ 643e5cd (FULL pack green; money-path check done; live $6 buy recorded: `0x48349a8d…164992`) | User squash-merges; user opens the upstream PR from `docs/upstream/`. |
| 06 | Guardian alerts + read-only bot commands | D Antigravity (reassigned from E, 2026-10-04) | **Slice A merged. Slice B: CHANGES (small)** at 8a2b31b: 2 must-fix (worker reads `status`/`multiplier` snapshots nothing writes; prev-state age) + 4 should-fix. Security checks done | agy fixes; re-review (no new pack needed for small fixes). bStock pause alerts ship inactive; `engine.pauseState` follow-up after WO-05 merges. |
| 07 | Sell + Switch | C | Wave 2 | Blocked on gates V-B1/V-B2 (Mon). **Escalate review to Claude** (contracts + money). |
| 08 | Guardian autopilot | C | Wave 2 | Blocked on V-AW. No longer owns `skills/share-true-trading/**` (moved to WO-05). **Escalate to Claude.** |
| 09 | Pies | B | Wave 2, after WO-05 | |
| 10 | Rewards → Stocks | D | Wave 2, if V-C gates pass | |
| 11 | Evidence, fixtures, docs | F Cline | Support | Never money paths, contracts or engine. |
| 12 | UI (every page) | A Sonnet (backup D) | Free to start; now also owns the landing lead (moved from WO-01 on 2026-10-04) | The user decides when to tell Sonnet. Landing: "Your stocks, in shares" + Portfolio / Radar / Guardian. |

Blueprint milestones M0–M7 are covered: M0–M2 done (engine, ShareGuard, CLI); M3 base merged; WO-01 now covers only stage events (the landing lead moved to WO-12); M4 Trap Shield = integrity grade + WO-04 ghost rule + WO-06 `/shield`; M5 agent layer = WO-05; M6 Telegram = WO-06; M7 polish/submission = WO-11/WO-12 + Fri–Sun calendar.

## 5. Calendar (UTC; Lagos = UTC+1)

| When | Milestone |
|---|---|
| Mon 5 Oct | User runs V-B1/V-B2 in pre-market and regular hours. WO-03 merged. |
| Tue 6 | WO-01 follow-up merged (urgent, stage events only; earlier if ready); WO-04 merged; dispatch wave 2 (WO-02B, WO-05, WO-07). |
| Wed 7 | WO-06 merged; V-E decided. |
| **Thu 8, 23:59** | **Cut line**: anything unmerged ships flag-off. |
| Fri 9 | Integration day: flags on, e2e on EC2, live $6 receipt/switch/sell by the user. Claude's quota resets: **final review window**. |
| **Sat 10, 23:59** | **Code freeze.** Demo video, README. |
| **Sun 11, 12:00** | **Lock** (submit before). |

Slippage rule: protect the cut line. If a WO is late, shrink it (ship slice A behind its flag) rather than move dates. Priority if time runs short: WO-01 → WO-04 → WO-02B → WO-05 → WO-06 → WO-03 → WO-07 → WO-12 screens → WO-09 → WO-08 → WO-10.

## 6. Review protocol (what you run every day)

1. Agent pushes `mod/WO-xx-<slug>` and opens a PR with the template.
2. The user runs, in WSL: `bash /mnt/c/Users/DELL/Projects/tally/scripts/review-pack.sh mod/WO-xx-<slug>` (prefix `FULL=1` to add build + e2e + e2e:foundation; use FULL for anything touching `apps/web` or before approval).
3. You read `review/mod_WO-xx-<slug>/`: `meta`, `commits`, `stat`, `files`, `diff`, `uncommitted`, `owned` (from `scripts/review_owned.py`, matching the backticked patterns in the WO's **Owns**), `checks` (typecheck/lint/format/test[/build/e2e]).
4. You write `review/mod_WO-xx-<slug>/REVIEW.md`: verdict **APPROVE** / **APPROVE after fix N** / **CHANGES**, pack line (✓/✗ per check), ownership note, numbered findings (severity, `file:line`, exact change), strengths, notes. On re-review append `# Re-review: <branch> @ <sha>` to the same file.
5. The user pastes REVIEW.md to the agent; agent replies per finding; repeat.
6. After APPROVE, the user squash-merges; every other agent rebases: `git fetch origin && git rebase origin/main` (then `pnpm install` if the lockfile changed).

Merge discipline: ≤ 4 PRs open; merge one at a time; rebase before review. Only REVIEW.md goes to agents; when main changes they just rebase (don't re-paste work orders unless the WO changed; then tell them to re-read it).

## 7. Review checklist (what Claude checks; check the same)

**Correctness, the part judges and users care about**
- Shares are **bigint 1e18** (`@tally/core` units, `mulDiv`). Floats only for display percentages.
- **No 1:1 defaults.** Unknown multiplier → `shares: null` + reason, excluded from totals, visible note. Multipliers come from the engine (`engine.facts()` / registry readings: bStock on-chain `uiMultiplier`, Ondo accepted baseline/feed), never from symbols.
- **Ticker/issuer from the registry by address**, never inferred from symbol suffixes. Unknown → `null`, "Not a recognised tokenized stock".
- **No fixture data labelled live.** Fixtures only when `TALLY_FIXTURES === "1"`; missing keys in non-fixture mode → throw (health shows it). Fixture `source` names the fixture file.
- Honest labels: reconstructions vs real simulations, `chain-logs` vs API, stale data shows its age. No "you should" copy (facts only).
- Never trust the API's gas (always 450000): RPC estimate × 1.25, simulated at the exact limit (the web plan's rule; the local model only prices the fee). Enforce the **6 USDT** minimum. Ondo is RFQ and closed outside US hours; bStock `marketStatus` is always null (pause comes from the on-chain pause manager); xStocks are AMM-only and often ghost.
- Raw token units are authoritative in receipts; shares derived; frozen conversion at fill time.

**Architecture (MODULES.md §3)**
- Only owned paths touched (`owned` file = 0 outside, or each outside file approved in the WO). Shared files (`flags.ts`, navigation, workspace, root `package.json`, lockfile, CI) belong to WO-00 unless the WO approves.
- Pure logic in `packages/mod-<name>`, I/O only via `@tally/modkit` and `@tally/engine`. No direct Binance calls from modules/pages.
- Every fallback via `withFallback` calls `onWarn`; no silent `catch {}`; no unexplained `any`.
- Feature flag `FEATURE_<NAME>`, default off; flag off → nothing breaks.
- `<ModuleBoundary>`: degraded card only when the module throws or never succeeded; stale data is shown with a notice.
- View-model contract: `apps/web/modules/<name>/view-model.ts` (typed, unit-tested, includes `stale`/`ageMs`/`source`/empty/error; no functions, no wall-clock `asOf`) + unstyled `plain.tsx`. Pages only under `apps/web/app/dev/<name>/` (flag-gated). Real pages belong to WO-12.
- Health reports `intervalMs`; worker jobs throw when everything fails (not "ok" with warnings).

**Safety and operations**
- No secrets, keys or RPC URLs in code, logs, fixtures or PR text. No `.env` committed. No transaction sent, no deploy. ShareGuard and the existing buy path unchanged.
- `fixtures/raw/` and `spike/results/` never edited (new files only).
- Disk/retention: snapshot writes deduped; `prune` retention per kind; evidence kinds (`receipt`, `decision`, alerts) excluded (`EVIDENCE_SNAPSHOT_KINDS`).
- Rate limits: shared ≤ 4 req/s to the Market API; bounded loops; timeouts.
- `uncommitted` file empty (or the agent explains/discards stray edits).

## 8. Approving scope expansions

Agents must stop and ask before touching non-owned paths or adding dependencies. You may approve when **all** hold:
- **Additive only**: new functions/files/exports; no change to existing signatures or behaviour.
- It's the natural home (e.g. collectors in `packages/binance/src/collectors.ts` + `collector-fixtures.ts` + tests, exposed on `engine.collectors`; chain readers as new files in `packages/chain/src/`).
- No two open WOs own the same file at once (check the index; collectors.ts has been approved for WO-03 and WO-04 additively, so expect a trivial rebase conflict, which is fine).
- Dependencies: only if unavoidable and already used elsewhere in the repo (same version range).

Record every approval in the WO's **Owns** as `Approved <date>, additive only: …` (see WO-03/WO-04), commit to main, and tell the agent to rebase. That keeps `review_owned.py` accurate. Never approve: changes to ShareGuard, the buy path, `packages/core/src/integrity.ts` (orchestrator applies wiring), fixtures/raw, spike/results, CI secrets.

## 9. Escalations (updated 2026-10-05)

The chief engineer reassigned the escalations to the day-to-day orchestrator. The orchestrator does the money-path and security checks itself and writes them into the branch's REVIEW.md ("For Claude" sections became "Money-path check" or "Security checks"). Claude (Opus 5.5) does **one** thing: the whole-repo review, the demo flow and README claims against evidence, **Fri 9 – Sat 10**. Ask the user to bring Claude in earlier only for a disagreement you cannot resolve from the docs.

## 10. Open gates (MODULES.md §5) and who runs them

| Gate | What | Who | Your job |
|---|---|---|---|
| V-AW | `baw --help` / policy docs: spend caps or session policy on BSC? | User runs, you read | Decide WO-08 scope (autopilot only with caps; else alerts-only + one-tap confirm). |
| V-B1/B2 | Direct stock→stock and stock→USDT quotes, pre-market and regular hours (Mon) | User, `research/module_viability.py` | Pass: `SWAP`, cost < 0.5% at $7. Fail → WO-07 ships sell-only or flag-off. |
| V-B3 | Fork tests J, K | WO-07 agent | |
| V-B4 | One live $6 sell and switch reconcile | User, Fri | |
| V-C1…C3 | Rewards ≥ $6 claimable, principal unchanged, reward→stock route | User + `baw defi`, DeFi API (`investType` required) | Fail → cut WO-10. |
| V-E | Free, reliable earnings-date source | You | Find one or leave the disabled stub (WO-06 task 8). |

## 11. Known API findings (don't rediscover)

- HMAC headers `X-OC-APIKEY`/`X-OC-TIMESTAMP`/`X-OC-SIGN`, `/build` prefix. Errors come back as **HTTP 200 with a `code`**: always check it. 40304 region, 40375 below minimum.
- Market API: trades, holders, top-trader, candles work; `rwa/price` batch works; `market/price` returns 50000.
- Transaction API simulation of router swaps returns `0x` output (output amounts can't be read from it).
- DeFi API needs `investType`.
- xStocks aren't in the RWA Data API.
- `fonts.googleapis.com` returns 404 at the root: any response means reachable (WSL build failures on `next/font` were network, not code).
- Probe recorder: `spike/record_module_probes.py` (read-only; the user runs it).

## 11b. Known issues for later (don't fix inside other WOs)

- `engine.portfolio` / `portfolioFor` (`packages/engine/src/views.ts`) uses floats and silently skips tokens with an unknown multiplier. The web Portfolio still reads it. WO-12 should switch the page to WO-03's `PortfolioVM`; WO-05 adds a separate bigint `sharesOf` and leaves this function alone.

- **Decision (2026-10-05, orchestrator, chief engineer delegated): ghost-rule wiring into the core quote path is NOT done.** Radar shows the cleaned-flow grade via the view model; `/quote`, the bot and MCP show the engine's raw-volume grade. Reason: a ghost verdict makes a token non-executable, so wiring it would change buy gating on the money path just before submission, and the engine would have to read the worker's SQLite store. The README must say the Radar grade is "cleaned flow" and the quote grade is "raw volume". Opus 5.5 may revisit it in the Fri 9 review.

## 12. Hard rules you must keep

- Never create, request, print or store private keys or seed phrases. Secrets live only in the server's env file, never in git or chat.
- Never deploy spike code. Agents never send transactions or deploy; live actions are the user's.
- Agents never merge to main; only the user squash-merges.
- **The Developer Experience Report is written by the user, not by an AI.** You may collect evidence pointers (MODULES.md §6), never draft its prose.
- No new modules or scope beyond `MODULES.md` without the user's yes; keep away from routing and fair-value features.
- Protected files (e.g. `.github/` templates) may reject automated commits: hand the content to the user to save.

## 13. Common user questions (short answers)

- *Command to update a worktree after a merge?* `git fetch origin && git rebase origin/main` (then `pnpm install` if the lockfile changed). On the Windows clone (on main): `git pull`.
- *Who squash-merges?* The user, never the agent.
- *PR still pending after merge?* Squash-merge closes it; if it shows open, the branch was merged locally/other way: close it manually.
- *Re-paste work orders to agents?* No. Only REVIEW.md. If a WO changed, tell the agent to re-read it after rebasing.
- *Reassign a WO?* Yes; WOs belong to modules. Same branch, handover note in the PR, never two agents on one WO at once. Update the README table.
- *Which script before review?* `review-pack.sh <branch>` (FULL=1 for web/e2e or final approval).
- *Agent at its usage limit?* Backup per the README team table (A→D for UI; Codex↔Codex/OpenCode).

## 14. Pending orchestrator actions (start here)

1. WO-04: review when ready; apply the ghost-rule wiring line yourself if it's port-only.
2. Tell D (Antigravity, took over WO-06 on 2026-10-04) to read WO-06 in full, task 9 included. Tell B that WO-05 follows WO-04.
3. Monday: collect V-B1/V-B2 results from the user; decide WO-07 scope. Collect V-AW; decide WO-08 scope.
4. Check that agy (D) has WO-01 M3 follow-up (stage events only) on a fresh branch from main, in parallel with WO-06; the landing lead is now WO-12's. After its `onStage` merges: dispatch WO-02 slice B (same branch `mod/WO-02-receipts`); tell the user when to hand WO-12 to Sonnet (WO-12 is no longer blocked by WO-01 files).
5. Keep §4 of this file updated after every merge (commit to main).
