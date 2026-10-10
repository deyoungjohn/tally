# Integrity grades

Every token gets a grade from A to F before you can buy it, and every point taken off is shown with its reason. The grade is computed by the pure engine in `packages/core`, so the web app, the Telegram bot and agents all see the same grade.

## The scoring

Start at 100 points and subtract:

| Condition | Points | Notes |
|---|---|---|
| Multiplier sources disagree by more than 0.1% | 25 | List, API and chain readings are compared. |
| Price more than 2% away from the US price in regular hours | 30 | Premium is measured per share, never per token. |
| Under $1,000 of onchain volume in 24 hours | 40 | Flagged as a **ghost market**. Not executable. |
| Trading status unknown | 10 | A missing status is never assumed open. |
| Token paused by the issuer | 50 | Not executable right now. |
| Token limited (for example around earnings) | 10 | |
| Issuer's latest reserve report older than 3 days | 10 | Only when a dated report exists. |
| One token is more than one share while another issuer's is one | 0 | Adds the **unit trap** badge, not a deduction. |

| Grade | Points |
|---|---|
| A | 90 to 100 |
| B | 75 to 89 |
| C | 60 to 74 |
| D | 40 to 59 |
| F | below 40 |

In the app, A and B read **Liquid**, C to F read **Low Liquidity**, and a ghost reads **Not Tradable**.

## Two grades, on purpose

* The **quote grade** on the Trade page uses raw 24-hour onchain volume, so it can be computed instantly for every quote.
* The **Radar grade** uses *cleaned flow*: trades left after bot wallets and router hops are removed. The two can differ, and the Radar page says which basis it uses. We chose not to wire the cleaned figure into the quote path, so the two never silently disagree inside one screen. See [Radar and Flow](../modules/radar-and-flow.md).

## The integrity log

Every check writes a record (inputs, outcome of pass, deduct, flag or skipped, and a one-line summary) whether or not it costs points. A fact that is missing carries the reason, and the quote shows it as a warning. The rule we followed throughout: **never add a check or a fallback that can fail silently.** An early adapter swallowed a schema failure and fell back to stale public data; every fallback now reports a warning.

## Checks against the issuer's own claims

The Ondo multiplier has no onchain source, so every reading is bounded:

* An increase of up to 3% is accepted unless the independent price check fails. The 3% is a judgement threshold, about five times the largest step observed (+0.58%).
* A decrease, or an increase above 3%, is accepted only when a split or dividend status was seen within 48 hours, the ratio is within 0.5% of a simple ratio (2, 3, 4, 5, 8, 10, 15, 20, 25, 30, 50, 3/2, 2/3 or their inverses), and the token price divided by the new multiplier is within 2% of the US share price.
* Otherwise the token stays blocked and flagged.

Only readings that pass are stored as the new baseline, so a bad reading cannot become the reference.
