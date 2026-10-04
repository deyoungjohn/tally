# Upstream PR ready for user submission

Repository: [binance/binance-skills-hub](https://github.com/binance/binance-skills-hub).
Target: `skills/binance-web3/binance-tokenized-securities-info/SKILL.md`.
Base checked: `9960c675387bd27f8866645b83693c1fa87242f6` (2026-10-04).
Patch: [binance-tokenized-securities-info.patch](binance-tokenized-securities-info.patch).
The user submits this upstream PR from their GitHub account. No upstream PR has been opened by the agent. This is a skill documentation correction grounded in recorded evidence, not a Developer Experience Report.

## Proposed title

Document all stock issuers, share multiplier sources, and BSC minimum/gas pitfalls

## Proposed PR body

The tokenized-securities skill describes Ondo as the only supported stock provider and instructs agents to always use API multipliers. Recorded BSC responses include xStocks (`type=2`) and bStock (`type=3`), and API/list ratios can disagree with the issuer contract. These instructions can misprice a stock in share units or treat missing market status as executable.

This patch documents all three public-list types, their symbol conventions and multiplier sources: bStock `uiMultiplier()`, xStocks `multiplier()`, and validated Ondo API readings. It retains unknown ratios as null with a reason and distinguishes Ondo-only status endpoints from issuer-specific pause checks. It also distinguishes token-derived price per share from an independent US reference and the authenticated list's per-token reference.

The read-only skill now warns its execution handoff about two recorded BSC pitfalls: a 5 USDT order was rejected because the minimum is denominated in USD (application minimum: 6 USDT), and the API's repeated `450000` gas value caused a real out-of-gas revert. Final gas must be estimated from the actual wallet for the final call, given a margin and simulated at that limit. Wallet execution still requires its own preview and confirmation.

Evidence and limits:

- [IDEAS F1](https://github.com/deyoungjohn/tally/blob/main/IDEAS.md#f1-market-data-and-units-2026-09-30-public-endpoints--bsc-rpc): three issuers, NFLX 10× versus 1×, contract selectors, multiplier disagreements and recorded xStocks BSC volume. The xStocks finding is dated and scoped to BSC; it is not a general assertion about other chains or current liquidity.
- [IDEAS F4](https://github.com/deyoungjohn/tally/blob/main/IDEAS.md#f4-trading-api-quotes-routes-and-fees-2026-10-01-all-runs): `40375`, USD-versus-USDT minimum, repeated gas placeholder and fee limitations.
- [IDEAS F6](https://github.com/deyoungjohn/tally/blob/main/IDEAS.md#f6-live-mainnet-buys-2026-10-01-burner-wallet-0x2bf7edf53bc6be6ff98f149387f3818ce28d2930-from-aws-seoul): live out-of-gas revert and successful buys with estimation and simulation.
- [IDEAS F10](https://github.com/deyoungjohn/tally/blob/main/IDEAS.md#f10-m1-engine-what-the-seoul-recordings-and-the-build-showed-2026-10-02): truncated authenticated registry, per-token reference correction, accepted-baseline rules and HTTP-200 region errors.
- [IDEAS F11](https://github.com/deyoungjohn/tally/blob/main/IDEAS.md#f11-m2-shareguard-v1-what-the-build-and-the-fork-tests-showed-2026-10-02): bounded Ondo feed, on-chain pause mechanisms and final-call gas evidence.

Validation: patch application checked against the pinned upstream source; statements cross-checked with the committed recordings and contract/engine documentation. No endpoint, dependency or execution behavior changes. No live trading was performed for this documentation patch.

## User submission steps

In your fork of `binance/binance-skills-hub`, on a new branch:

```bash
git switch -c docs/share-true-stock-data
git apply --check /absolute/path/tally/docs/upstream/binance-tokenized-securities-info.patch
git apply /absolute/path/tally/docs/upstream/binance-tokenized-securities-info.patch
git diff --check
git diff -- skills/binance-web3/binance-tokenized-securities-info/SKILL.md
```

Review against upstream's latest main before committing. If it changed, reconcile the diff rather than forcing the patch. Commit and push from your account, then open a PR using the proposed title/body above. Record the upstream PR link in Tally's WO-05 PR. No human-report text is included here.
