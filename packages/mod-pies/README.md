# Pies — WO-09 Slice A

Pure allocation logic, fixed example templates, and the UI contract. `FEATURE_PIES`
remains off by default. Execution, persistence, the worker job, and the product Pies
page belong to later slices.

`PIE_TEMPLATES` contains exactly `tech-trio`, `index-core`, `growth-five`, and
`mag7-preview`. Every template says “Example allocation, not advice”.
`validateTemplate(unknown)` checks uppercase unique tickers, integer weights, and a
10000 bps total. Availability is computed from an injected buyable set; the web
loader supplies `BUYABLE_TICKERS` from `apps/web/lib/tickers.ts`.

`valuePie(template, holdings, prices)` consumes the WO-03 holding subset. It sums
shares across issuers before multiplying by a per-share USD price. Shares and USD
use bigint 1e18; `balanceTokens` retains the token's native raw units. Missing
shares/prices carry visible reasons and prevent planning. Holdings outside the
selected template are untouched. `referencePerShare` divides the authenticated
per-token reference by its recorded ratio; it never supplies a guessed ratio.

`rebalancePlan(input)` returns current values/weights, targets/drift, ordered legs,
deferred legs, missing facts, totals, notes, and an optional no-plan reason.

- Rebalance targets use the current value of the selected pie. Wallet USDT is
  available to fill gaps but does not change those target values.
- Invest mode buys only. Targets use current value plus the requested investment;
  spend is capped by both that request and the wallet balance.
- Drift below the configured threshold for every ticker returns `within threshold`.
  Drift at the threshold permits planning; no cash is spent merely because a
  balanced pie has idle wallet USDT.
- Sells consume the largest issuer position first. Full liquidation uses the
  exact raw balance; partial liquidation floors bigint conversions. The buy budget
  includes only retained sells' raw-token value, after the configured haircut.
- Buys use the injected `bestIssuer(ticker)` selector; a missing issuer is visible.
  xStocks cannot execute. Allocation uses exact largest-remainder rounding, with
  template order breaking ties. Excess budget remains unspent.
- Orders under the minimum are deferred. Deferred sells never fund buys; deferred
  buys remain unspent. IDs identify pie/side/ticker/token; sequence numbers order
  all proposed legs, including deferred ones, so retained sequences can have gaps.
- Sell proceeds are estimates. This slice supplies no fee or quote guarantees;
  Slice B must re-quote, simulate, and obtain each user's signature before execution.

`PieRun` is plain data. `applyLegResult` returns a new run and changes just the named
pending leg. Terminal results cannot be overwritten. `pieRunState` reports a
failed run as `partially rebalanced`; later legs stay pending. There is no retry,
scheduler, storage, or transaction sender.

The UI agent imports `PieTemplatesVM`, `PieVM`, and `RebalancePlanVM` and their
builders from `apps/web/modules/pies/view-model.ts`. Every bigint crosses that
contract as an integer decimal string. Each VM supplies state, empty, error,
stale, ageMs, source, and a reason. There is no wall-clock `asOf`.

`loadPies` reads only an injected snapshot store: `portfolio/<verified-wallet>`,
`registry/bsc`, and `prices/bsc`. It prefers the price snapshot's reference, falls
back to the registry reference with `onWarn`, and reports the oldest age and all
sources actually used. It requires an explicit wallet USDT balance to produce a
plan. Issuer selection is injected, never inferred from registry order. Portfolio,
registry, and price TTLs match their existing collectors (300s, 60s, 15s).
Callers must supply a verified session wallet in production.

The unstyled component is inside `ModuleBoundary`. `/dev/pies` renders clearly
labelled constructed data, including a stale snapshot and a failed run. It is 404
when `FEATURE_PIES` is off, or in production unless `TALLY_DEV_PREVIEWS=1`.
Browser evidence is written to ignored `apps/web/test-results/`; no PNG is committed.

Offline checks:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm e2e
pnpm e2e:foundation
pnpm --filter @tally/web exec playwright test --config modules/pies/playwright.config.ts
```

Core tests cover the 10:1/1:1 share vector, recorded authenticated NVDA reference
conversion, missing shares/prices, invalid templates, unavailable tickers,
minimums, raw-token sell rounding, issuer split order, exact budget allocation,
threshold/no-plan, empty pies, and immutable failed-leg state. VM tests cover
empty/below-threshold/partial state, serialisation, stale age, warned reference
fallback, missing observations, and a failed snapshot read. The preview specs
exercise 375/768/1280px and reduced motion using constructed data only.

No live transaction command applies to Slice A. The commands above validate its
logic and previews without a Binance API call or signing a transaction.
