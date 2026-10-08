# Tally

**Buy tokenized shares, at the best prices.** Tally compares the same US stock across the three issuers that tokenize it on BNB Chain (Ondo, bStocks, xStocks). It quotes each one in share units (tokenized shares track a stock's price; they are not the underlying shares), routes your buy to the best true price, and settles through **ShareGuard**, a contract that reverts if you'd receive fewer shares than promised.

Built for **BNB Hack: Tokenized Stocks Edition** (submissions lock Sun 11 Oct 2026, 12:00 UTC).

> Status: **building, M0 (foundations) in review.** The plan and its evidence are in this repo; the app is built milestone by milestone (M0–M7).

| Document | What it is |
|---|---|
| [`TALLY_BLUEPRINT.md`](TALLY_BLUEPRINT.md) | The build plan: verified facts, decisions, architecture, ShareGuard v1 spec, milestones and exit checks |
| [`DESIGN.md`](DESIGN.md) | The UI system: tokens, motion, components (beUI), responsive rules, page blueprints |
| [`IDEAS.md`](IDEAS.md) | Ideation and validation record, including **Findings F1–F9** (the evidence behind every design decision) |
| [`research/`](research) | Market snapshot, winner analysis, compliance and region checks (scripts + data) |
| [`spike/`](spike) | ShareGuard spike, fork tests with real Trading API calldata, live-buy script and results. **Spike code is not for deployment.** |

## Develop
```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test
cd apps/web && TALLY_ALLOW_MISSING_GEO=1 pnpm dev    # region gate fails closed without Cloudflare's header
pnpm build && pnpm e2e                               # Playwright at 375/768/1280 (needs the standalone build)
```
Node 22, pnpm 10. Copy `apps/web/.env.example` to `apps/web/.env.local`. Deployment to the Seoul EC2: [`docs/deployment.md`](docs/deployment.md).

Not investment advice. Not available in restricted regions.

## Tally for agents

Tally is also a small tool service for AI agents that deal in tokenized stocks on BNB Chain: **information** (share-true quotes, an A–F integrity grade with a reason for every check, holdings in shares) and **execution** (unsigned buys through ShareGuard, which reverts if the buyer would receive fewer shares than the floor; unsigned sells to USDT). The agent's own wallet signs; Tally holds no keys and sends nothing. The tools are an MCP server (`packages/mcp`) plus a Wallet Skill (`skills/share-true-trading/`). Today it runs as a local process; a hosted endpoint is not live. Details and limits: [`docs/for-agents.md`](docs/for-agents.md).

## Roadmap

- **Atomic Migrate (not built).** Migrating a position from one issuer to another (for example Ondo to bStock) in one transaction needs a contract, because the Binance aggregator refuses a direct stock-to-stock route: it answers `40368` ("Ondo asset on chain 56 can only pair with allowed stablecoin(s)") on every bStock/Ondo pair we tried. Selling to USDT and buying the target both work (see `MODULES.md` §5). The design: a small contract pulls the source tokens, sells through the allow-listed router, then buys the target through the deployed ShareGuard (which enforces the destination share floor, pause checks and the multiplier feed) and refunds any USDT residue, reverting the whole move if either floor is missed. Until then, Tally's **Migrate** is a guided two-step flow (sell, then buy) with a combined result, labelled as two separate transactions.
- **Total return by issuer (not built).** For one ticker, show which issuer actually passes dividends through to the holder: Ondo reinvests them in the multiplier (more shares per token), while bStock and xStocks report the dividend separately, which the API exposes as `latestDividend`. Tally already reads each issuer's multiplier; the missing piece is keeping a timestamped history of those readings, so that share growth and the reported dividend can be shown side by side. Until that history exists, Portfolio shows dividends only as shares gained.
- **Paying with, or selling for, BNB (not built).** Today USDT is the only trading currency and BNB only pays network fees. Paying with BNB works at the API only for bStock tokens (it refuses a non-stablecoin pairing for Ondo tokens, error `40368`), ShareGuard v1 does not accept native BNB (it would need a wrapped-BNB path through the contract and new fork tests), and a sale for native BNB leaves no ERC-20 transfer log for the receipt to check. Tally does not offer a BNB-to-USDT swap.

