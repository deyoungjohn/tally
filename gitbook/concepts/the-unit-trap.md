# The unit trap

**One token is not one share.** Each tokenized stock has a *share multiplier*: shares of the stock that one token represents, as a fixed-point number with 18 decimals. Tally multiplies every token amount by its multiplier before it shows you anything.

## A real example

| Token | Issuer | Shares per token |
|---|---|---|
| NFLXon | Ondo | 10.0 |
| NFLXB | bStock | 1.0 |
| NFLXx | xStocks | 1.0 |

Ondo's NFLX token costs ten times what bStock's costs, because it is ten shares. A tool that sorts by token price reports a spread of about 899% between them. Other cases measured on 30 September 2026: GME 869%, MRVL 713%, IBM 563%.

Of 458 Ondo tokens on BNB Chain, 242 had a multiplier other than 1 (CRWD 4.0, SOXS 0.1017).

## The multiplier moves

Dividends and splits change it. For Ondo, multiplier growth tracks the dividend yield: across 26 tokens the Pearson correlation was 0.917 (PFE: multiplier +6.09% against a 5.98% yield). So share count rises while the token count stays the same. Portfolio therefore shows dividends as shares gained.

## Where the number comes from

| Issuer | Source Tally reads | Notes |
|---|---|---|
| bStock | `uiMultiplier()` on the token | Matched the API on 38 of 38 tokens. |
| xStocks | `multiplier()` on the token | Display only. On-chain and API disagreed on 12 of 38. |
| Ondo | The API's share multiplier | **No on-chain read exists.** Bounded by sanity checks, and signed into ShareGuard. See [Multiplier sources](../smart-contracts/multiplier-sources.md). |

The same token can show three different multipliers depending on the source (NVDAx: list API 1.000000, dynamic API 1.000918, contract 1.001701). Tally records every reading, compares them, and says so when they disagree.

## The rule Tally never breaks

Shares are `bigint` end to end. A multiplier that cannot be read is shown as unknown with the reason and is never assumed to be 1:1. A token whose shares are unknown has no Sell button and no share count in the totals.
