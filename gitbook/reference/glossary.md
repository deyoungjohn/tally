# Glossary

**Aggregator.** Binance's Web3 trading API, which finds a route and builds swap calldata. For stocks it returns one route from one vendor (LiquidMesh).

**bStock.** Binance's tokenized stock issuer on BNB Chain. Symbols end in `B` (NVDAB). Multiplier on-chain (`uiMultiplier()`).

**Corporate action.** A split or other change to an Ondo multiplier beyond the per-update bound. The owner registers it on ShareGuard so a signed update can apply it once.

**Feed (Ondo feed).** The signed, bounded multiplier updates ShareGuard accepts for Ondo assets, which have no on-chain multiplier.

**Fixture.** A recorded API response or a fake chain used so the app can run offline. Fixture data is always labelled as a recording.

**Floor / minimum shares.** The least number of shares the buyer will accept, enforced on-chain by ShareGuard. Below it the whole transaction reverts.

**Ghost market.** A token with under $1,000 of on-chain volume in 24 hours. Its price can be stale. Tally does not execute against it.

**Guarded buy.** A buy that goes through ShareGuard.

**Integrity grade.** An A to F grade per token, from 100 points minus listed deductions, each with a reason.

**Migrate.** Moving a holding from one issuer of a stock to the other, in two confirmed transactions (sell, then buy).

**Multiplier.** Shares of the stock that one token represents, as a number with 18 decimals. Also written "shares per token".

**Ondo.** A tokenized stock issuer. Symbols end in `on` (NVDAon). No on-chain multiplier.

**Pie.** A basket of stocks bought together from one budget.

**RFQ (market-maker order).** A short-lived signed order from a market maker. A route may include one; it can expire before it mines.

**Router.** The contract that executes the swap. ShareGuard allow-lists it.

**Share-true.** Everything counted and compared in shares of the stock, not tokens.

**Snapshot.** A timestamped record a worker writes to the store for the web app to read.

**Unit trap.** One token being more than one share, so token prices and balances mislead.

**xStocks.** A tokenized stock issuer with almost no liquidity on BNB Chain. Symbols end in `x`. Shown as data, never executed.
