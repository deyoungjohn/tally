# Changes made after the submission deadline

The submission deadline was 11 October 2026, 12:00 UTC. This file lists everything that changed in the repository afterwards, so a reader comparing the code with the live site is not surprised.

## Reference points

| What | Commit |
|---|---|
| Last commit made before the deadline | `790eb22` (10 Oct 2026) |
| README rewrite (documentation only, 12 Oct) | `e5d8323` |
| GitBook's own sync commits (12 and 14 Oct) | `c55cc89` to `aa67ffc`; they added `SUMMARY.md` files and edited `gitbook-docs.yaml` |
| All code fixes below, in one commit | "Minor Post Deadline Fixes" (15 Oct) |

To see exactly what changed: `git diff 790eb22 HEAD --stat -- . ':!gitbook'`.

## What the commit contains

**Pages and wording**
- `/pies` is now `/baskets` and `/docs` is now `/contracts`; the old addresses redirect. The footer links to Contracts and the "Two live guarded buys" block was removed.
- "Purchase" and "Sale" are now "Buy" and "Sell" throughout. "Not Tradable" is now "No Liquidity", and each token on Radar shows one liquidity badge.
- Flow shows dollar figures and "Updated N min ago". Guardian has a new title. Home copy was edited. The hero cards link to their feature and pause while the pointer is over them.

**Behaviour**
- Radar thresholds: under $100 of 24-hour onchain volume is No Liquidity, under $1,000 is Low Liquidity.
- A quote more than 50% away from the US price is shown as unusable. Binance's "Insufficient liquidity" answer is explained on buy, sell and Migrate.
- Statement PDF and CSV are rebuilt at every download and include every verified Activity transaction. Realized and unrealized PnL are switched off (commented out, milestone 7).
- Receipts show confirmed transactions as confirmed: an Etherscan V2 explorer fallback sits behind the RPC (`ETHERSCAN_API_KEY`, see `docs/deployment.md`).
- Live fills compares against quotes recorded by the server when a plan is issued ("plan-quote" snapshots).
- The Migrate review prices the wallet's exact balance, shows the real shortfall (BNB or tokens), and estimates the sell fee before an approval.

**Tokens**
- Nine more tokens are listed as buyable: AMZNB, GMEB, BMNRB and NFLXB (already enabled on the guard by the owner), and INTCon, METAon, MSFTon and MSTRon. The last four need an owner transaction first; `contracts/script/AddOndoBatch3.s.sol` and `contracts/tools/gen_ondo_seeds_batch3.py` prepare it, and the steps are in `docs/deployment.md`.
- Some of these tokens have no usable market on BNB Chain yet. The app says so on their row; it does not hide them.

**Operations**
- Balance reads are sent to the RPC provider in whole chunks and the held-stock scan is cached for 45 seconds, which cut the number of provider calls per portfolio refresh by more than 90%.
