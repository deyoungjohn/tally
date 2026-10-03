# WO-00 Foundation: modkit, worker, flags, health, ModuleBoundary

| | |
|---|---|
| Agent | B (Codex #1) |
| Branch | `mod/WO-00-foundation` |
| Priority | **Blocking.** Merge target Sun 4 Oct 12:00 UTC. Keep it small. |
| Read first | `MODULES.md` §3, `AGENTS.md`, `CLAUDE.md`, blueprint §5, §6, §14 |

## Owns

- `packages/modkit/**` (new)
- `apps/worker/**` (new) except `apps/worker/src/jobs/<module>.ts` files created later by other work orders
- `apps/web/components/module-boundary.tsx`, `apps/web/app/api/modules/health/route.ts`, `apps/web/lib/flags.ts`
- `apps/web/components/site-header.tsx` (nav entries only)
- `packages/config/src/flags.ts` (new), `packages/config/src/index.ts` (export only)
- `packages/core/src/status.ts` + its test (the `offhours` mapping only)
- Root: `package.json` (scripts), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.github/workflows/ci.yml` (only to include new packages)
- Skeletons (tasks 6, 8): `packages/mod-*/**`, `apps/web/modules/**`; dependency lines in `apps/web/package.json`, `apps/bot/package.json`; `packages/core/src/status.test.ts`
- `apps/web/e2e/foundation.config.ts` (foundation Playwright config, see review)
- `apps/web/app/dev/page.tsx` (dev preview index)
- Approved 2026-10-03 (scope questions): `apps/web/components/module-boundary-client.tsx`, `apps/web/e2e/module-boundary.spec.ts`, `apps/web/app/dev/foundation/**` (gated like the dev index)
- Approved 2026-10-03, **additive only**: collector APIs in `packages/binance/src/**` (typed `rwa/tokens` list and batch `rwa/price` with zod schemas, through the existing client) and `packages/engine/src/**` (an `engine.collectors` accessor), with tests. No change to existing signatures or behaviour.

## Tasks

1. **`packages/modkit`** (`@tally/modkit`), with Vitest tests:
   ```ts
   export interface Snapshot<T> { kind: string; key: string; data: T; source: string; observedAt: number; notes?: string[] }
   export interface Latest<T> extends Snapshot<T> { ageMs: number; stale: boolean }
   export interface SnapshotStore {
     put<T>(s: Snapshot<T>): void;
     latest<T>(kind: string, key: string, opts: { maxAgeMs: number; now?: number }): Latest<T> | null;
     history<T>(kind: string, key: string, sinceMs: number, limit?: number): Snapshot<T>[];
   }
   export function openStore(path?: string): SnapshotStore;            // node:sqlite DatabaseSync; default $TALLY_DATA_DIR/tally.db; ":memory:" in tests
   export type JobName = ModuleName | `collect-${string}`;   // collectors get their own health rows
   export interface HealthRow { module: JobName; ok: boolean; lastRunAt: number; lastOkAt?: number; lastError?: string }
   export interface ModuleHealth { report(module: JobName, r: { ok: boolean; error?: string; now?: number }): void; get(m: JobName): HealthRow | null; all(): HealthRow[] }
   export async function withFallback<T>(steps: { name: string; run: () => Promise<T> }[], onWarn: (msg: string) => void): Promise<{ value: T; source: string }>;
   ```
   - bigint values must round-trip (serialise as strings with a marker; test it).
   - `withFallback` calls `onWarn` for every failed step with the step name and error kind; throws an aggregated error if all fail.
2. **Flags**: `packages/config/src/flags.ts` exports `ModuleName = "receipts" | "quality" | "statement" | "flow" | "guardian" | "autopilot" | "sell" | "switch" | "pies" | "rewards"` and `flags(env = process.env): Record<ModuleName, boolean>` reading `FEATURE_<NAME>=1`; default all off. `apps/web/lib/flags.ts` reads server-side only.
3. **Worker** `apps/worker` (`@tally/worker`, tsx): `pnpm worker <job>` dynamically imports `src/jobs/<job>.ts` (no shared index file, so later work orders add jobs without touching yours). Each job exports `{ name, intervalMs, run(ctx) }`; the runner loops, catches every error, writes health, backs off on failure, and exits cleanly on SIGINT. `ctx` = `{ store, health, engine, onWarn, now }`.
   Collector jobs owned here: `collect-registry` (RWA list incl. statusInfo, every 60 s), `collect-prices` (`rwa/price` batch, every 15 s). In fixture mode (`TALLY_FIXTURES=1`) they read the newest recordings instead of the network.
4. **`<ModuleBoundary module="flow" fallback?>`**: server component checks the flag (renders nothing if off) and health; client error boundary renders a DESIGN.md "degraded" card with the last-good time if the module throws. `/api/modules/health` returns `health.all()` plus flags (no secrets).
5. **Status**: map `marketStatus: "offhours"` (Ondo, observed 2026-10-03 in `spike/results/module_probes_20261003T121018Z.json`, `G_underlying_market_NVDAon`) to `closed`, and `"paused"` explicitly; add test cases. Don't change anything else in core.
6. **Skeletons** so later work orders never touch root files: `packages/mod-receipts`, `mod-statement`, `mod-flow`, `mod-guardian`, `mod-autopilot`, `mod-pies`, `mod-rewards`, each with `package.json` (deps: `@tally/core`, `@tally/modkit`, vitest), `tsconfig.json`, `src/index.ts` (empty export) and a passing placeholder test; added to the workspace and to `apps/web`, `apps/worker`, `apps/bot` dependencies. Also add dependency `grammy` to `apps/bot` now (WO-06 needs it).
7. **Nav**: add Portfolio, Radar, Guardian, Pies, Quality entries to the header, each shown only when its flag is on.

8. **UI contract skeletons**: `apps/web/modules/<name>/` for receipts, quality, statement, flow, guardian, autopilot, switch, pies, rewards, each with `view-model.ts` (exported placeholder type + loader returning an empty state) and `plain.tsx` (renders the empty state inside `<ModuleBoundary>`). `apps/web/app/dev/page.tsx` lists `/dev/<name>` previews, available only when `NODE_ENV !== "production"` or `TALLY_DEV_PREVIEWS=1`. Write a short `apps/web/modules/README.md` explaining the view-model contract (see `AGENTS.md`, UI split).

## Exit checks

- [ ] Unit tests: store put/latest/history, staleness, bigint round-trip, withFallback (all fail / second succeeds / warns), flags parsing.
- [ ] A test job that throws on every run: runner keeps running, health shows `ok: false` with the error, other jobs unaffected (two jobs in one test).
- [ ] Playwright: a page with two boundaries where one module throws shows one degraded card and the other module's content.
- [ ] `pnpm worker collect-registry` in fixture mode writes snapshots; `/api/modules/health` shows it.
- [ ] All existing tests, lint, typecheck, build green. No change outside owned paths.

## Out of scope

Any module logic; any change to engine wiring beyond exposing it to `ctx`.
