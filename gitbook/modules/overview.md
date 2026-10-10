# Product modules

Tally's features beyond the quote and the buy are **modules**. Each follows the same shape, which kept a team of agents from stepping on each other and kept every module switchable.

| Layer | Where | Rule |
|---|---|---|
| Logic | `packages/mod-<name>` | Pure TypeScript with tests. No UI, no network on the request path. |
| Collection | `apps/worker/src/jobs/<name>.ts` | Writes snapshots to the store; has an interval, a timeout and independent failure handling. |
| View model | `apps/web/modules/<name>/` and `/api/vm/<name>` | A typed state (loading, empty, stale, degraded, normal) plus a plain unstyled component. |
| Page | `apps/web/app/...` and `components/` | Renders view-model states. Never computes them. |
| Switch | `FEATURE_<NAME>` | Off means the route answers 404 and the worker is not started. |

## The modules

| Module | What it does | Page |
|---|---|---|
| [Receipts](receipts.md) | Verifies a transaction on-chain and shows shares received against the floor. | `/receipt/[hash]` |
| [Portfolio and statements](portfolio-and-statements.md) | Holdings in shares across issuers, activity, a statement export. | `/portfolio` |
| [Radar and Flow](radar-and-flow.md) | Integrity grades for every token and per-issuer trade-flow panels. | `/radar` |
| [Guardian and the Telegram bot](guardian.md) | Alerts about tokens you hold. | `/guardian`, the bot |
| [Selling and Migrate](selling-and-migrate.md) | Sell to USDT, and move a position between issuers. | Trade, Portfolio |
| [Pies](pies.md) | Basket buying from a budget and weights. | `/pies` |
| [Autopilot](autopilot.md) | Policy and decisions in shadow mode. Nothing executes. | `/dev/autopilot` |

## Honesty rules every module follows

* A number that cannot be verified is shown as unknown with the reason, never guessed.
* A stale module shows its last good data and its age. Raw worker errors are not shown to visitors.
* Data from a recording is labelled as a recording.
* A module says what it did not do: for example, Receipts reports amounts only when the chain has confirmed them.
