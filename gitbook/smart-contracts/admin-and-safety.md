# Admin powers and safety

## Who can do what

ShareGuard has one owner (`Ownable2Step`), one feed signer and a pause switch.

| Function | Caller | Effect |
|---|---|---|
| `setRouter(router, allowed, approveTarget)` | owner | Allow-list a router and the address that must be approved to pull `tokenIn`. Both are `0xB444…dDA5` for the Binance aggregator. |
| `setAsset(stock, cfg, seedMultiplier)` | owner | Configure an asset: source, enabled, step bound, pause check, pause manager. |
| `registerCorporateAction`, `clearCorporateAction` | owner | The one expected change beyond the step bound. |
| `setFeedSigner(signer)` | owner | Replace the signer; the zero address disables feed updates. |
| `setMaxAge(seconds)` | owner | Feed staleness limit, one hour to seven days. |
| `pause()`, `unpause()` | owner | Stops new swaps. It cannot trap funds because none are held. |
| `rescue(token, to)` | owner | Sweeps tokens or BNB sent to the contract by mistake. Not callable inside a swap. |
| `transferOwnership` / `acceptOwnership` | owner / new owner | Two steps: ownership moves only when the new owner accepts. |

## Configuration guardrails in `setAsset`

The contract refuses an asset when:

* the address has no code, or is the guard itself, or is an allow-listed router or approve target;
* `source` is `None`;
* `maxStepBps` is above 1000 (10%): a slip cannot open the bound;
* a Feed asset is enabled with a step of zero;
* a pause manager is set on a pause check that does not use one.

## What the owner can and cannot do

**Can:** enable or disable assets, change routers, pause, change the signer, rescue stray tokens.

**Cannot:** move user funds (none are held), change the contract's logic (not upgradeable), bypass `minShares` for a swap (the caller chooses it), or decrease an Ondo multiplier without a matching registered corporate action.

The owner key is a real risk and is held on the chief engineer's own machine with an encrypted keystore. A multi-signature owner is not built.

## Design decisions made in the build

1. The first Ondo multiplier is owner-seeded (the deploy script has only the deployer key and cannot produce a signed first value).
2. Feed updates are monotonic by `validAfter`.
3. A swap needs `minShares > 0` and `tokenIn != stock`.
4. `maxStepBps` is capped at 10%, and `maxAge` is bounded.
5. `tokenIn` is not allow-listed: the guard holds nothing between transactions, so an odd input token can only hurt the caller who chose it. An independent review may disagree.
6. Pause checks fail closed.
