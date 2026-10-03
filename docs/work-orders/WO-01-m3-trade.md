# WO-01 M3 web trade flow

| | |
|---|---|
| Agent | A (Claude Code) |
| Branch | `mod/WO-01-m3-trade` |
| Priority | **Critical path.** Merge target Tue 6 Oct. |
| Read first | Blueprint §7.6, §8, §11, §17 (M3 row), `DESIGN.md`, `CLAUDE.md` (wallet requirements carried into M3), `IDEAS.md` F6, F10, F11 |

## Owns

- `apps/web/app/trade/**`, `apps/web/app/t/**` (ticker pages), `apps/web/components/trade/**`, `apps/web/lib/trade-plan/**`
- `apps/web/app/api/quote/**`, `apps/web/app/api/plan/**`, the Ondo feed-signer service route (`apps/web/app/api/feed/**`)
- `apps/web/e2e/trade*.spec.ts`
- `apps/web/app/page.tsx` (landing copy update, see task 5)

## Tasks

The milestone exactly as the blueprint defines it (§17, M3), with these adjustments from `MODULES.md` v2:

1. Ticker page with consolidated quote card (via `@tally/engine` only), integrity grade and plain-words route.
2. Privy sign-in; embedded wallet on chain 56; read `eth_chainId` at send time and `switchChain(56)` before signing.
3. Top-up tier 1 and 2 (deposit address with BEP-20 warning; connect funded wallet).
4. Trade plan: amount → fresh quote → exact-amount allowance → re-quote → gas estimate (local model, never the API's 450000) → simulate at the exact limit → sign → receipt in shares. **Expose each stage as a typed event** (`onStage(stage, payload)`) so WO-02 Receipts can record intent/quote/simulation/realized without editing your code.
5. Landing page: lead with "Your stocks, in shares" + Portfolio / Radar / Guardian; the quote comparison is shown on ticker pages, not as the hero.
6. Error copy from blueprint §11 (40375, 40304, insufficient shares, TokenPaused).

## Exit checks (blueprint M3 plus)

- [ ] Fixture-mode e2e: full plan to the signature step at 375/768/1280, reduced motion.
- [ ] `onStage` emits intent, quote, simulation, signed, realized with typed payloads (unit test).
- [ ] The user, on the EC2/PC, buys $6 of NVDA on mobile without help (you write the steps in the PR; the user runs it and posts the tx hash).
- [ ] No regression: existing e2e (landing, region gate) green.

## Out of scope

Sell, switch, portfolio page (WO-03), receipts storage (WO-02).
