# WO-12 UI: every page and visual component

| | |
|---|---|
| Agent | A (Sonnet / Claude Code cloud session), after or alongside WO-01 (M3). Backup: D (Antigravity) |
| Branch | `mod/WO-12-ui` for the correction pass, then one slice per screen: `mod/WO-12-ui-portfolio`, `-radar`, `-guardian`, `-receipts`, `-pies` |
| Read first | `DESIGN.md` (exactly), `AGENTS.md` (UI split), `apps/web/modules/README.md` (view-model contract, from WO-00), each module's `view-model.ts` |

## Owns

- `apps/web/app/**` except `apps/web/app/api/modules/**` (WO-00) and `apps/web/app/dev/**` (module previews)
- `apps/web/components/**` except `apps/web/components/module-boundary.tsx` (WO-00)
- `apps/web/app/globals.css`, design tokens, `apps/web/e2e/*.spec.ts` for the pages you build
- (WO-01 M3 pages are already yours.)

## Rules

- Build screens **only from view models** (`apps/web/modules/<name>/view-model.ts`). Never call engine, store or APIs from a page directly, and never edit a view model. If you need a field, list it in your PR under "View-model requests"; the module agent adds it.
- Every module screen sits inside `<ModuleBoundary module="…">`, and you design its four states: loading, empty, stale ("last update 4 min ago"), degraded (module down). Flag off = the entry point is hidden.
- `DESIGN.md` exactly; beUI components restyled with our tokens; 375 / 768 / 1280 px and reduced motion for every screen.
- Copy: facts, never advice ("Your shares are unchanged", not "You should switch").

## Tasks, in order

1. **Correction pass** on what exists (landing, M3 screens): the user gives one numbered list with screenshots per pass; fix every item; reply per number with a before/after screenshot.
2. **Landing**: lead with "Your stocks, in shares" and Portfolio / Radar / Guardian; quote comparison lives on ticker pages.
3. **Portfolio** (from `PortfolioVM`, `StatementVM`, `ActivityVM`, row actions from `SellSheetVM` / `SwitchSheetVM`, `DefiCardVM`): holdings in shares, issuer breakdown, tabs Holdings · Activity · Statement, row actions, DeFi card.
4. **Radar** (from `RadarVM`, `FlowPanelVM`): grade cards, filters, ticker detail with the flow panel.
5. **Guardian** (from `AlertFeedVM`, `GuardianSettingsVM`, `AutopilotVM`): feed, rule settings, Telegram link, autopilot caps and decision log.
6. **Receipt and Quality** (from `ReceiptVM`, `QualityVM`): `/receipt/[txHash]` share page with the Quoted → Simulated → Received ladder, `/quality`.
7. **Pies** (from `PieTemplatesVM`, `PieVM`, `RebalancePlanVM`).

Start each screen as soon as its view model merges; until then, build against the placeholder view model from WO-00.

## Exit checks (per slice)

- [ ] Screenshots at 375 / 768 / 1280 and with reduced motion, for the normal, empty, stale and degraded states.
- [ ] Playwright spec per page (fixture mode), including flag off and module degraded.
- [ ] No direct data access from pages (`grep` for `@tally/engine`, `@tally/modkit` imports under `apps/web/app/` returns only view-model imports).
- [ ] Existing e2e (landing, region gate, trade) green.

## Quota note

Claude Pro has usage windows. Batch work: one correction list per pass, one screen per session. If you hit the limit mid-slice, push your branch with a handover note; Antigravity continues the same slice.
