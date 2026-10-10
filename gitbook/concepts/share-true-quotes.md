# Share-true quotes

A quote in Tally answers one question: *for this much money, how many shares does each issuer give me, and what is the real cost?*

## The algorithm

For a ticker and an amount (in USD or in shares):

1. **Resolve the tokens.** All registry tokens for the ticker on BNB Chain. Only bStock and Ondo can be executed.
2. **Read in parallel** for each token: the multiplier, the trading status and the inputs of the integrity grade.
3. **Find the reference price per share.** From the authenticated list: `referencePrice ÷ tokenToShareRatio`. The list's `referencePrice` is per *token*: Ondo NFLX shows 680.80 for ten shares of $68.08. Dividing makes two issuers agree to 0.01%. Not dividing misprices Ondo NFLX tenfold.
4. **Convert the amount to USDT.** The minimum is 6 USDT. A request in shares is estimated, quoted once, scaled and quoted again.
5. **Quote each executable token** through the Binance Web3 aggregator with the user's wallet (or a placeholder in browse mode: quotes do not depend on wallet history).
6. **Compute per token:** `sharesOut = tokensOut × multiplier / 1e18`; `usdPerShare = amountIn / sharesOut`; `premium = usdPerShare / reference − 1`; route and hop count.
7. **Estimate the fee** from a gas model calibrated on real fills, labelled approximate. The exact figure is estimated at confirm time.
8. **Rank** by `(amountIn + fee) / sharesOut`. Ties go to fewer hops, then the better grade. The winner is marked Best and the saving against the runner-up is shown.
9. **Cache** per ticker and amount bucket (6, 10, 25, 50, 100, 250, 500, 1000 USDT, else the exact amount) for 10 seconds.

## Route choice

The aggregator can return several routes for one token. Some are pool routes through ordinary liquidity pools, some are *market-maker (RFQ)* orders that live only a few seconds. Tally prefers a pool route when its output is within 0.5% of the best market-maker route, and flags a market-maker route (with a "confirm promptly" warning) when it is better by more than that or is the only one. We learned this the hard way: see [Challenges](../building-tally/challenges.md#a-quote-that-expires-before-it-mines).

The card price and the plan you confirm come from the same route choice, so the number you see is the number you are guaranteed against.

## Honest limits

* Quotes are quotes, not fills. A recorded quote landed within ±0.1% of its price on most routes, but one live fill came in 0.51% below its quote. That is exactly what the minimum-shares floor is for.
* Price impact was below 0.003% up to $1,000 in every recorded quote; fills at those sizes are untested.
