# WO-03 Portfolio + Statement

| | |
|---|---|
| Agent | D (Antigravity), also the backup UI agent if Sonnet is out of quota |
| Branch | `mod/WO-03-statement` (slice A pure logic now; slice B view models after WO-00) |
| Read first | `MODULES.md` §4.2, blueprint §11 (Portfolio), M4 row of §17, `DESIGN.md` |
| Fixtures | `spike/results/module_probes_20261003T130122Z.json` keys `X_recent_pnl`, `X_token_pnl`, `X_dex_history`, `X_portfolio_overview_tf`; burner wallet `0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930` |

## Owns

- Approved 2026-10-09 (`docs/prompts/wo03-portfolio-suggestions.md`): the `suggestions` field of the portfolio view model and its pure builder (`packages/mod-statement/src/suggestions*` and tests), `apps/web/modules/statement/**` and `apps/web/app/api/vm/portfolio/**` additively; the README roadmap line.
- Approved 2026-10-09 (`docs/prompts/wo03-portfolio-speed.md`): `apps/web/app/api/portfolio/route.ts`; in `packages/engine/src/views.ts` only `portfolioFor` (and `radarFor` concurrency if the prompt's condition holds) and the engine-side cache of `inspectTicker`; their tests.
- `packages/mod-statement/**`
- `apps/web/modules/statement/**`, `apps/web/app/dev/statement/**`
- `apps/worker/src/jobs/statement.ts`
- Approved 2026-10-03, **additive only**: portfolio collector methods in `packages/binance/src/collectors.ts`, `packages/binance/src/collector-fixtures.ts`, `packages/binance/src/collectors.test.ts`, and their exposure on `engine.collectors` in `packages/engine/src/**`; `zod` dependency in `packages/mod-statement/package.json` and `pnpm-lock.yaml`

## Tasks

**Slice A (pure):**
1. Parse the four portfolio endpoints (zod schemas inside your package) into `Holding`, `Trade`, `PnlLine`.
2. `toShares(line, multiplierObservation | null)`: bigint maths; when no observation exists for the trade time, use today's ratio and set `convertedAtTodaysRatio: true`.
3. `statement(holdings, trades, receipts?)`: holdings in shares per ticker across issuers, average cost per share, realized P&L, and a `differsFromApi` note when the API figure and receipts disagree by > 1%.
4. CSV export function (pure). PDF optional only if it needs no new dependency.

**Slice B (view models, after WO-00):**
5. UI split: you ship the logic and a typed view model plus a plain, unstyled component in `apps/web/modules/<name>/`; the UI agent (WO-12, Sonnet) builds the real page from your view model. Don't style, don't create pages outside `apps/web/app/dev/<name>/`. `PortfolioVM` (holdings in shares as the headline, per-issuer breakdown, which tabs are available: Holdings · Activity only when `FEATURE_RECEIPTS` · Statement) and `StatementVM` (lines, totals, export actions, `differsFromApi` and `convertedAtTodaysRatio` notes). Each holding row carries `rowActionsSlot` metadata (token, issuer, balance) so WO-07 and WO-10 can attach actions.
6. Worker job: refresh portfolio snapshots for connected wallets every 5 min (keys from Privy session on the server, never stored client-side beyond the address).

## Exit checks

- [ ] Unit tests from the fixture keys above, including a per-token → per-share conversion and the today's-ratio flag.
- [ ] API failure (mocked 50000) → statement from receipts only, with a visible note.
- [ ] View-model unit tests: empty wallet, one issuer, two issuers of the same ticker, API down.
- [ ] Flag off → Portfolio shows holdings only (no statement), no errors.

## Out of scope

Styling and the Portfolio page itself (WO-12). Sell/Switch actions (WO-07).
