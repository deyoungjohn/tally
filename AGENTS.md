# Rules for every AI agent working on Tally

This repo is built by several AI coding agents in parallel (Claude Code, Codex, Antigravity, OpenCode, Cline). Each agent gets **one work order** from `docs/work-orders/`. An orchestrator reviews every PR, then the chief engineer (the user) reviews and merges. These rules apply to every agent and every tool; they add to `CLAUDE.md`, which also applies in full.

## Before you write code

1. Read, in this order: your work order (`docs/work-orders/WO-xx-*.md`), this file, `CLAUDE.md`, `MODULES.md` (v2), then the parts of `TALLY_BLUEPRINT.md`, `DESIGN.md` and `IDEAS.md` your work order cites.
2. Reply (in your tool's chat, not in the repo) with: your task list, the exit checks you will prove, and any question. If something in the work order contradicts the code, **stop and ask**. Don't guess.
3. Create your branch from the latest `main`: the exact name is in your work order (`mod/WO-xx-<slug>`).

## Boundaries

- **Touch only the paths your work order owns.** Anything else needs the orchestrator's OK first. Shared files (`packages/config/src/flags.ts`, `apps/web` navigation, `pnpm-workspace.yaml`, root `package.json`, `pnpm-lock.yaml`, CI) are owned by WO-00; other work orders don't edit them.
- **No new dependencies** unless your work order lists them. Ask first otherwise (parallel lockfile changes conflict).
- **Never** create, request, print, log or commit a private key, seed phrase, API key or RPC URL with a key in it. Read secrets from the environment only. Never commit `.env`.
- **Never** send a transaction, call a live trading endpoint, or deploy a contract. Live checks are run by the user; write the exact command for them in your PR.
- **Never** edit files in `packages/binance/fixtures/raw/` or `spike/results/` (recorded evidence). Add new fixtures as new files.
- **Never** change the deployed ShareGuard (`contracts/src/ShareGuard.sol`) or the existing buy path. New contracts are separate files and separate deployments, and only where your work order says so.
- Don't write the Developer Experience Report or anything that reads like it. You may add evidence pointers to `IDEAS.md` only if your work order says so.

## Where code runs

Cloud agents usually run in US data centres, and the authenticated Binance Web3 API refuses US callers (`40304`). **Build and test against recorded fixtures**: `packages/binance/fixtures/raw/` and `spike/results/module_probes_*.json` (newest of each kind). BSC RPC reads work from anywhere with a provider key from the environment (`BSC_RPC_NODEREAL`, `BSC_RPC_ANKR`); the public RPC refuses `eth_getLogs`. If you need a new live recording, write a read-only recorder in `spike/` and ask the user to run it.

## How modules are built (MODULES.md §3)

- Business logic: pure functions in `packages/mod-<name>/src`, typed inputs in, typed results out, no I/O. Tests with Vitest against fixtures.
- I/O: only through `@tally/modkit` (snapshot store, health, fallbacks) and `@tally/engine`. Never rebuild the engine wiring; never call Binance from a module or a page except through the engine/collector.
- Every fallback calls `onWarn` and every missing fact carries a reason. No silent `catch {}`. No `any` without an eslint-disable comment explaining why.
- Shares are bigint 1e18 fixed point (`@tally/core` units). Never do share maths in floating point.
- UI: follow `DESIGN.md` exactly; beUI components restyled with our tokens; check 375/768/1280 px and reduced motion. Wrap your module's UI in `<ModuleBoundary module="…">`.
- Behind your feature flag (`FEATURE_<MODULE>`), default off.

## Definition of done (put the evidence in the PR)

1. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` all pass. If you touched `apps/web`: `pnpm build` and the Playwright specs your work order lists.
2. Every exit check in your work order has evidence: test name, command output or screenshot.
3. Failure test: show what your module does when its primary source fails (fixture or mocked error) and when the snapshot is stale.
4. No file outside your owned paths changed (`git diff --stat main...HEAD`).
5. PR description uses `.github/pull_request_template.md`, including "What I did NOT do" and "Commands for the user to run live".

## Working style

- Small commits with clear messages; rebase on `main` before asking for review (`git fetch && git rebase origin/main`).
- One PR per work order. If the work order is too big, ship it in the slices it lists (each slice is its own PR on the same branch prefix, e.g. `mod/WO-04-flow-a`).
- When review comes back, address every numbered finding and reply to each in the PR with what you changed.
- If you're blocked for more than 30 minutes, say so in your tool and stop rather than working around the rules.
