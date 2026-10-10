# Repository layout

A pnpm workspace on Node 22. The source is at [github.com/deyoungjohn/tally](https://github.com/deyoungjohn/tally).

```
apps/
  web/        Next.js 16 app: UI, /api route handlers, the region gate (proxy.ts)
  worker/     Collectors and scheduled jobs that fill the snapshot store
  bot/        Telegram bot (grammY)
packages/
  core/       Pure TypeScript, no I/O: share maths, multipliers and Ondo bounds,
              integrity grade, gas model, TTL cache, registry types, consolidated quote
  binance/    Signed Web3 API client: pacing, retries, HTTP-200 error codes,
              zod schemas, typed endpoints, public API, fixture transport
  chain/      viem clients with failover, ABIs, multiplier readers, gas planning
  engine/     Wires core + binance + chain; trade plan; sell plan; the CLI
  modkit/     Snapshot store (SQLite), module health, ModuleBoundary helpers
  config/     Feature flags, region block list, constants
  mcp/        MCP server exposing Tally's tools
  mod-*/      One package of pure logic per product module:
              receipts, statement, flow, guardian, pies, autopilot, rewards
contracts/    Foundry project: ShareGuard v1, tests (unit, fuzz, fork A to I),
              deploy and asset-addition scripts, recorded captures
skills/       The share-true-trading skill for Binance's Wallet Skills
research/     Evidence behind the design (read-only)
spike/        Early experiments (read-only; the spike contract must never be deployed)
docs/         Work orders, review notes, deployment guide, evidence
gitbook/      These pages
```

## Conventions

* **Product modules** follow one shape: a pure package (`packages/mod-*`) with tests, a view model and a plain unstyled component in `apps/web/modules/<name>/`, a worker job if it needs one, and a flag that switches it off. See [Product modules](../modules/overview.md).
* **Tests:** Vitest for TypeScript, Foundry for contracts, Playwright for the UI at 375, 768 and 1280 px and with reduced motion.
* **Naming of tokens:** Ondo `on`, bStock `B`, xStocks `x` after the ticker. The UI never shows a bare ticker where a token is meant.
