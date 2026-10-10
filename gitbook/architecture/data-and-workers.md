# Data, workers and the snapshot store

Anything slow, rate-limited or historical runs outside the web server. Workers collect data and write **snapshots** into one SQLite database. Pages read those snapshots, so a page never waits on a Binance call for these modules and never fails because one upstream call did.

## The store

* **One table** (`snapshots`: kind, key, payload, observed-at) plus a small `module_health` table. SQLite runs in WAL mode with a 30-second busy timeout, shared by the web server and every worker.
* **Always the latest row per kind and key** is protected from pruning, and receipts, decisions and alerts are never pruned at all.
* **Reads carry their age.** Each read returns the data, how old it is and whether that is stale. Nothing silently serves old data as fresh.
* **Snapshots are encoded** so `bigint` survives the round trip.

## The workers

| Job | What it does |
|---|---|
| `collect-registry` | Reads the RWA token list every minute into the registry snapshot. |
| `collect-prices` | Reads token prices in batches of 20 addresses (a larger batch made the API answer HTTP 414). |
| `receipts` | Follows transactions the browser hinted at and records the chain-verified outcome. |
| `statement` | Builds wallet statements and portfolio snapshots for signed-in wallets. |
| `collect-flow`, `flow` | Collect trade history per token and compute the 1-hour, 24-hour and 7-day windows. |
| `guardian`, `bot` | Evaluate alert rules and deliver Telegram messages. |
| `autopilot` | Shadow-mode decisions and a position collector. Nothing executes. |
| `prune` | Applies retention (for example 30 minutes for the large flow tapes). |

Each job has an interval, a timeout and independent failure handling: one failing job backs off while its siblings keep running. A health row is written after every run, and a failed health write is retried and never ends the worker.

## Module health

`/api/modules/health` and each module's view model report whether a job is healthy, late or has never succeeded. A late module's page shows its last good data and its age, with a plain "catching up" notice. Raw worker error text stays in the logs.

## Feature flags

Each module has a `FEATURE_*` flag (receipts, quality, statement, flow, guardian, autopilot, sell, switch, pies). A flag off means the route answers 404 and the worker for it is not started. The flag-to-worker mapping and the commands to run them are in the repository's [deployment guide](https://github.com/deyoungjohn/tally/blob/main/docs/deployment.md).

## Lessons from running it

Two incidents shaped this design; both are written up in [Challenges](../building-tally/challenges.md): the store growing to 8.3 GB in eight hours when every flow tape was kept for seven days, and a single SQLite write lock killing four workers at once.
