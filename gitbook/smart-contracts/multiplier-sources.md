# Multiplier sources and the Ondo feed

ShareGuard needs the share multiplier to turn tokens into shares. Where it reads it depends on the asset's `Source`.

| Source | Issuer | Read from | Notes |
|---|---|---|---|
| `UiMultiplier` | bStock | `token.uiMultiplier()` | Onchain every swap. |
| `Multiplier` | xStocks | `token.multiplier()` | Supported by the contract; Tally never routes there. |
| `Feed` | Ondo | A stored value kept current by signed updates | Ondo exposes no onchain multiplier. |

## The Ondo feed

Ondo's multiplier exists only in an API. ShareGuard therefore keeps its own stored value per Ondo asset, and the stored value can change only in three controlled ways.

1. **The owner seeds the first value** when enabling the asset (`setAsset(stock, cfg, seedMultiplier)`). It applies only while the feed has never been seeded, because there is nothing earlier to bound it against.
2. **The feed signer signs bounded updates.** A swap can carry a `FeedUpdate { stock, multiplier, validAfter, validUntil }` signed with EIP-712 by the feed signer. The contract recovers the signer, checks the validity window, and then applies the update.
3. **The owner registers a corporate action** for changes the bound does not allow (a split).

## What an update may do

| Rule | Effect |
|---|---|
| **Per-asset step bound** (`maxStepBps`, set to 300 = 3% for the Ondo tokens, capped at 1000 by the contract) | An increase beyond the bound reverts with `UpdateOutOfBounds`. |
| **Decreases are never within step** | A decrease needs a registered corporate action that matches exactly. |
| **Monotonic by `validAfter`** | An older signed update can never roll the value back (`UpdateOlderThanStored`). The same update may be resubmitted by another user's swap and only refreshes the timestamp. The same `validAfter` with a different value reverts (`UpdateConflictsWithStored`). |
| **Freshness** | The stored value is stale after `maxAge` (default three days, settable between one hour and seven days). A stale value reverts the swap (`FeedStale`) unless the swap carries a fresh update. |
| **Corporate action** | `registerCorporateAction(stock, expectedMultiplier, notBefore)`: the one change beyond the step the owner expects. It is consumed when the matching update is applied, and cannot be applied before `notBefore`. |

Because the update rides inside the user's own swap, there is no separate keeper transaction. The off-chain engine signs an update only when the stored value is stale or differs from its accepted multiplier by more than one part per million.

## What a compromised signer could do

It could push an Ondo multiplier up by at most 3% per update, forward in time only, within the validity window. It cannot decrease a value, cannot exceed the cap, and cannot touch bStock assets. Combined with the onchain `minShares` the buyer chose, that is a small, bounded exposure. It is still a trust assumption, and it is listed in the [security model](../architecture/security-model.md).

## Off-chain checks on the same data

The engine applies its own sanity rules (the Ondo bounds, the ratio test and the independent price check) before it will sign anything. They are described in [Integrity grades](../concepts/integrity-grades.md). The contract's rules are the last line, not the first.
