# Tally

**Shares, not tokens.** Tally compares the same US stock across the three issuers that tokenize it on BNB Chain (Ondo, bStocks, xStocks). It quotes each one in real share units, routes your buy to the best true price, and settles through **ShareGuard**, a contract that reverts if you'd receive fewer shares than promised.

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
Node 22, pnpm 10. Copy `apps/web/.env.example` to `apps/web/.env.local`. Deployment to the Seoul EC2: [`deploy/README.md`](deploy/README.md).

Not investment advice. Not available in restricted regions.
