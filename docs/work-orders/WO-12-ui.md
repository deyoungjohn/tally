# WO-12 UI: every page and visual component

| | |
|---|---|
| Agent | A (Sonnet / Claude Code cloud session), free to start (WO-01 no longer holds landing files). Backup: D (Antigravity, currently busy with WO-01 and WO-06) |
| Branch | `mod/WO-12-ui` for the correction pass, then one slice per screen: `mod/WO-12-ui-portfolio`, `-radar`, `-guardian`, `-receipts`, `-pies` |
| Read first | `DESIGN.md` (exactly), `AGENTS.md` (UI split), `apps/web/modules/README.md` (view-model contract, from WO-00), each module's `view-model.ts` |

## Owns

- Approved 2026-10-09 (`docs/prompts/wo12-token-icons.md`): `apps/web/components/ui/token-icon*`, `apps/web/public/tokens/**`, `apps/web/lib/token-icons.generated.ts`, `scripts/token-icons.mjs`, and presentational use of the icon in the picker, issuer list, Holdings, Statement and Send components.
- Approved 2026-10-09 (`docs/prompts/wo12-pies-page.md`): the new page `apps/web/app/pies/**` and `apps/web/components/pies/**` (except `use-pie-run*.ts`, which is Agent 09's), the Portfolio suggestions block, and the timing fix of `apps/web/e2e/radar-vm.spec.ts:70`.
- `apps/web/app/**` except `apps/web/app/api/modules/**` (WO-00) and `apps/web/app/dev/**` (module previews)
- `apps/web/components/**` except `apps/web/components/module-boundary.tsx` (WO-00)
- `apps/web/app/globals.css`, design tokens, `apps/web/e2e/*.spec.ts` for the pages you build
- Landing files (`apps/web/app/page.tsx`, `apps/web/components/home/**`, `apps/web/e2e/home.spec.ts`): moved here from WO-01 on 2026-10-04. WO-01 (D) still owns `apps/web/components/trade/use-trade-flow.ts`, `trade-stages*` and `e2e/trade.spec.ts` until it merges; do not edit those concurrently.

- Mount point requested by WO-02 slice B: render `<ReceiptRecorder />` (from `apps/web/modules/receipts/recorder.tsx`) once in the root layout when `FEATURE_RECEIPTS` is on. Render only; do not edit the component.

## Rules

- Build screens **only from view models** (`apps/web/modules/<name>/view-model.ts`). Never call engine, store or APIs from a page directly, and never edit a view model. If you need a field, list it in your PR under "View-model requests"; the module agent adds it.
- Every module screen sits inside `<ModuleBoundary module="…">`, and you design its four states: loading, empty, stale ("last update 4 min ago"), degraded (module down). Flag off = the entry point is hidden.
- `DESIGN.md` exactly; beUI components restyled with our tokens; 375 / 768 / 1280 px and reduced motion for every screen.
- Copy: facts, never advice ("Your shares are unchanged", not "You should switch").

## Tasks, in order

1. **Correction pass** on what exists (landing, M3 screens): the user gives one numbered list with screenshots per pass; fix every item; reply per number with a before/after screenshot.
2. **Landing** (moved from WO-01): lead with "Your stocks, in shares" and Portfolio / Radar / Guardian; quote comparison lives on ticker pages.
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

## Wave 3 (2026-10-06)

Connect the merged module view models (Portfolio, Radar and flow, Receipt and Quality, `/docs` For agents, then Pies and a safe Guardian) in the order and with the rules in `docs/prompts/wo12-modules.md`. Approved additive: new routes under `apps/web/app/api/vm/**` that call the module loaders on the server (public data only; Guardian never takes an address from the request). Guardian settings wait for server-side session verification, which is the chief engineer's decision.

Decisions 2026-10-06 (answers to the Portfolio PR): (1) `wallet:active` is registered by the new verified route in the WO-06 follow-up (`POST /api/session/active-wallet`); WO-12 only calls it after sign-in when `flags.statement` is on, with `Authorization: Bearer <getAccessToken()>` and `x-tally-wallet`, keeping Privy's functions in refs (wallet bridge rule). Until then the statement view stays at its honest "not collected yet". (2) With `statement` off the page keeps today's engine-based Portfolio and Sell entry point: confirmed, flag off means unchanged. (3) View-model requests: approved additive exception to "never edit a view model": WO-12 may add optional fields only, with tests, in a small PR separate from the screen PRs: statement VM a distinct "never collected" state, `realizedKnown`, and the reason when shares are unknown; receipts `ActivityVM` rows get a timestamp. No other view-model change. USDT and BNB for "Other assets": keep using the existing `/api/holdings`, no view-model field.


Decisions 2026-10-07 (view-model requests from the Receipt and Radar slices). Approved as a second additive exception to "never edit a view model": WO-12 may add **optional fields only**, with tests, in a small PR separate from the screen PRs, touching only `apps/web/modules/receipts/view-model.ts` (and its test) and `apps/web/modules/flow/view-model.ts` (and its test). Nothing else in those modules, no change to the worker, the verification code or any package.
1. `ReceiptVM`: optional `symbol` (for example `NVDAB`, via `tokenSymbol(ticker, issuer)` from `apps/web/lib/tickers.ts`) and `issuer`. Derive the issuer from the **verified stock address** against the registry snapshot when it is available; otherwise take it from the browser hint and mark it `issuerTrust: "client-hint"`; otherwise `null` (the screen then shows the ticker). Never guess.
2. `ReceiptVM.ladder[]`: optional `unit` per stage, `"tokens"` or `"usdt"`, saying what the stage's amount field holds (a sell's stages are USDT, a buy's are tokens and shares). Existing fields keep their meaning.
3. `RadarVM` grades: optional `executable: boolean | null` with `executableReason: string | null`, taken from the facts the engine row and registry already carry (ghost, pause, unknown multiplier); if it cannot be derived from existing fields without new logic, return `null` and the reason rather than computing it. Optional `cleanedFlowUsd24h: string | null` (E18 string) taken from the existing flow aggregate for that token; if no such field exists, stop and report instead of computing new flow logic. `rawVolume24hUsd` stays as is, and the screen keeps the "cleaned flow" and "raw volume" labels apart.
