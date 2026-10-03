# Work orders: who builds what, when, and how it gets merged

Roles: **orchestrator** (Claude, in the Cowork session) writes work orders and reviews every PR; **chief engineer** (the user) reviews after the orchestrator, merges, runs anything live, and owns keys and deployments; **agents** build one work order each on their own branch.

## Team and assignments

| Agent (tool · model) | Strength we use it for | Wave 1 (Sat 3 – Mon 5) | Wave 2 (Tue 6 – Thu 8) |
|---|---|---|---|
| **A: Sonnet** (Claude Code cloud session, Claude Pro) | Owns **all UI**: reads screenshots, follows `DESIGN.md`, built the current screens | **WO-01 M3 trade flow** (in progress), then **WO-12** correction pass | **WO-12** screens (Portfolio, Radar, Guardian, Receipt/Quality, Pies) as view models merge |
| **B: Codex** (ChatGPT Plus #1) | Solid TypeScript, infra | **WO-00 Foundation**, then **WO-04 Flow** | **WO-09 Pies** |
| **C: Codex** (ChatGPT Plus #2) | Careful pure logic + tests, Foundry | **WO-02 Receipts + Quality** (pure part first) | **WO-07 Sell + Switch** (fork tests J/K), then **WO-08 Autopilot** |
| **D: Antigravity** (Gemini, Pro) | Logic + view models; **backup UI agent** | **WO-03 Portfolio + Statement** (logic + view models) | **WO-10 Rewards** (if gates pass) / takes over WO-12 slices if Sonnet is out of quota |
| **E: OpenCode** (strongest model you can connect) | Rules engine, bot | **WO-06 Guardian alerts** | Integration tests, e2e |
| **F: Cline · Muse Spark (free)** | Low-risk support only | **WO-11 Evidence, fixtures, docs** | README, demo script, screenshots |

**UI split:** module agents ship logic + a typed view model + a plain component in `apps/web/modules/<name>/`; Sonnet (WO-12) owns every page and visual component and builds them from those view models. No file has two owners. See `AGENTS.md`.

Notes:
- Claude Pro and ChatGPT Plus have usage windows. If Sonnet hits its limit, Antigravity continues the same WO-12 slice from Sonnet's branch (handover note in the PR). If a Codex account hits its limit, the other Codex or OpenCode continues the same branch.
- Work orders belong to the module, not the agent: you can reassign any of them; tell the orchestrator when you do.
- Agent F never touches money paths, contracts or engine code.
- Never run two agents on the same work order at once.

## Calendar (UTC; Lagos is UTC+1)

| When | Milestone |
|---|---|
| Sat 3, evening | Orchestration docs merged. Dispatch WO-00 (B), WO-01 (A), WO-02 pure part (C), WO-03 pure part (D), WO-06 pure part (E), WO-11 (F). |
| Sun 4, 12:00 | **WO-00 merged** (everyone rebases). Gate V-AW (`baw` capabilities) answered. |
| Mon 5 | V-B1/V-B2 run by the user in pre-market + regular hours. WO-02, WO-03 merged. |
| Tue 6 | **WO-01 (M3) merged.** WO-04 merged. Dispatch wave 2. |
| Wed 7 | WO-06 merged. Earnings source decided (V-E). |
| Thu 8, 23:59 | **Cut line.** Anything unmerged ships flag-off. |
| Fri 9 | Integration day: flags on, e2e on EC2, live $6 receipts/switch/sell. |
| Sat 10, 23:59 | Code freeze. Demo video, README. |
| Sun 11, before 12:00 | Submit. |

## Review protocol

1. The agent pushes `mod/WO-xx-<slug>` and opens a PR using the template.
2. The user runs, from the repo root:
   - PowerShell: `pwsh scripts/review-pack.ps1 mod/WO-xx-<slug>`
   - bash/WSL: `bash scripts/review-pack.sh mod/WO-xx-<slug>`

   This writes `review/<branch>/` (diff, changed-file list, owned-path check, and typecheck/lint/test output). `review/` is git-ignored.
3. The user tells the orchestrator "review WO-xx". The orchestrator reads the pack and writes `review/<branch>/REVIEW.md`: verdict **APPROVE** or **CHANGES**, with numbered findings (severity, file:line, what to change).
4. The user pastes the findings to the agent; the agent fixes and replies per finding; repeat from 2.
5. After the orchestrator approves, the user reviews, squash-merges to `main`, and tells the other agents to rebase.

**Merge discipline:** at most 4 PRs open at once; merge one at a time; rebase before review; WO-00 first, always.

## Dispatch prompt (paste into each agent, filling in the WO number)

```
You are agent <X> on the Tally team. Your work order is docs/work-orders/WO-<nn>-<slug>.md.
Read it, then AGENTS.md, CLAUDE.md and MODULES.md, then the sources it cites.
Before coding, reply with your task list, the exit checks you will prove, and any questions.
Work only on branch mod/WO-<nn>-<slug>, only in the paths the work order owns.
When done, open a PR with .github/pull_request_template.md filled in, with evidence for every exit check.
```

## Index

| WO | Title | Agent | Branch |
|---|---|---|---|
| 00 | Foundation: modkit, worker, flags, health, ModuleBoundary | B | `mod/WO-00-foundation` |
| 01 | M3 web trade flow (blueprint §17) | A | Sonnet's existing M3 branch |
| 02 | Receipts + Execution quality report | C | `mod/WO-02-receipts` |
| 03 | Portfolio + Statement | D | `mod/WO-03-statement` |
| 04 | Flow + Radar page | B | `mod/WO-04-flow` |
| 06 | Guardian alerts (rules, Telegram, web feed) | E | `mod/WO-06-guardian` |
| 07 | Sell + Switch issuer | C | `mod/WO-07-switch` |
| 08 | Guardian autopilot | C | `mod/WO-08-autopilot` |
| 09 | Pies | B | `mod/WO-09-pies` |
| 10 | Rewards → Stocks + idle-cash yield | D | `mod/WO-10-rewards` |
| 11 | Evidence, fixtures, docs support | F | `mod/WO-11-support` |
| 12 | UI: every page and visual component | A (backup D) | `mod/WO-12-ui`, then `mod/WO-12-ui-<screen>` |

(WO-05 is intentionally unused: the Radar page is part of WO-04.)
