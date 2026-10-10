# Radar and Flow

## Radar

Radar grades every token A to F with a reason for every deduction. See [Integrity grades](../concepts/integrity-grades.md). The Radar page shows the grade, the "vs US price" premium, the share multiplier and any flags (unit trap, ghost, paused), and links to how a grade is made.

## Flow

Flow answers "who is actually trading this token?". For each token, a collector gathers recent trades and classifies them: bot wallets and router hops are removed to leave **cleaned flow**. A per-issuer panel then shows, for the last hour, 24 hours and 7 days: net shares, buys and sells, the last real trade and the concentration of the top ten holders excluding custody. Large trades are listed.

* **Trade source:** Binance's trade history first, then chain logs as a fallback. The panel says which it used.
* **Windows are honest.** A window shows only when the history covers it. Otherwise it says "History still building".
* **Radar's cleaned grade** can differ from the quote page's raw grade on purpose.

## What is hard about it

The history is the hard part. The collector reads trades 100 at a time from a rate-limited API for hundreds of tokens, and expects each poll's newest page to overlap the previous poll. On busy tokens, or after a gap, it does not, so the window cannot be called complete. Making all three windows available all the time is a [milestone](../reference/roadmap.md), not solved.

## How it is served

Radar and Flow pages read two small snapshots per token (a summary and a ghost check) written by the `flow` worker every minute. They never decode the full trade tape on the request path. The first version did, about 300 to 450 MB of JSON per Radar load on a single thread, which froze the whole server for about 28 seconds. See [Challenges](../building-tally/challenges.md#a-radar-page-that-froze-the-whole-server).
