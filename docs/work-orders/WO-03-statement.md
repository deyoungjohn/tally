# WO-03 Portfolio + Statement

| | |
|---|---|
| Agent | D (Antigravity) |
| Branch | `mod/WO-03-statement` (slice A pure logic now; slice B UI after WO-00) |
| Read first | `MODULES.md` §4.2, blueprint §11 (Portfolio), M4 row of §17, `DESIGN.md` |
| Fixtures | `spike/results/module_probes_20261003T130122Z.json` keys `X_recent_pnl`, `X_token_pnl`, `X_dex_history`, `X_portfolio_overview_tf`; burner wallet `0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930` |

## Owns

- `packages/mod-statement/**`
- `apps/web/app/portfolio/**`, `apps/web/components/portfolio/**`
- `apps/worker/src/jobs/statement.ts`

## Tasks

**Slice A (pure):**
1. Parse the four portfolio endpoints (zod schemas inside your package) into `Holding`, `Trade`, `PnlLine`.
2. `toShares(line, multiplierObservation | null)`: bigint maths; when no observation exists for the trade time, use today's ratio and set `convertedAtTodaysRatio: true`.
3. `statement(holdings, trades, receipts?)`: holdings in shares per ticker across issuers, average cost per share, realized P&L, and a `differsFromApi` note when the API figure and receipts disagree by > 1%.
4. CSV export function (pure). PDF optional only if it needs no new dependency.

**Slice B (UI, after WO-00):**
5. Portfolio page: holdings in shares (headline), per-issuer breakdown, tabs Holdings · Activity (render WO-02's Activity component when its flag is on, otherwise hide the tab) · Statement.
6. Worker job: refresh portfolio snapshots for connected wallets every 5 min (keys from Privy session on the server, never stored client-side beyond the address).

## Exit checks

- [ ] Unit tests from the fixture keys above, including a per-token → per-share conversion and the today's-ratio flag.
- [ ] API failure (mocked 50000) → statement from receipts only, with a visible note.
- [ ] 375/768/1280 + reduced motion screenshots in the PR.
- [ ] Flag off → Portfolio shows holdings only (no statement), no errors.

## Out of scope

Sell/Switch buttons (WO-07 adds them to your row component via a prop slot; leave `rowActions?: ReactNode`).
