# WO-10 Rewards → Stocks + idle-cash yield (stretch)

| | |
|---|---|
| Agent | D (Antigravity), only if gates V-C1…V-C3 pass |
| Branch | `mod/WO-10-rewards` |
| Read first | `MODULES.md` §4.8 and `docs/archive/MODULES-v1.md` §6 |
| Fixtures | `spike/results/module_probes_20261003T130122Z.json`: `R_invest_earn*`, `R_invest_lp*`, `R_protocol_list`, `R_position_addresses` |

## Owns

- `packages/mod-rewards/**`
- `apps/web/components/portfolio/defi-card/**` (plugs into Portfolio)

## Tasks

1. Read positions (`position/list` with `addresses[]`) and claimable rewards; allow-list one protocol + investment id for v1.
2. Claim builder via the DeFi transaction API; claim types `REWARD_PROTOCOL`, `REWARD_INVESTMENT`, `LP_FEE` only; `REDEMPTION` hard-blocked (test).
3. Simulate the claim; refuse unless principal is unchanged and only reward balances rise.
4. Buy budget = reward amount from the claim tx's own Transfer logs (never wallet balance); then a guarded buy (WO-01).
5. Economic filter: disable when fee ÷ reward > 2% or reward < 6 USDT.
6. Idle-cash view: list the USDT Earn products (APY, TVL, protocol) as information only; no auto-deposit.

## Exit checks

- [ ] REDEMPTION blocked; principal-changed simulation refused (tests with fixtures/mocks).
- [ ] User-run live claim → buy, linked receipts (only if a ≥ $6 reward exists).

## Out of scope

Automation, auto-harvest, any simulated "auto" feature.
