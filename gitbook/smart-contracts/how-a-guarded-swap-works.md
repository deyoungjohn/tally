# How a guarded swap works

This page follows one `swapForShares` call through `_swap`.

## Preconditions the contract checks first

| Check | Error |
|---|---|
| `block.timestamp <= deadline` | `Expired(deadline)` |
| `amountIn > 0` | `ZeroAmount()` |
| `minShares > 0` (a zero floor would switch the guard off for a naive caller) | `ZeroMinShares()` |
| `recipient != address(0)` | `ZeroAddress()` |
| `tokenIn != stock` | `SameToken()` |
| `router` is allow-listed and is neither `tokenIn` nor `stock`; its approve target is not `tokenIn` or `stock` either | `RouterNotAllowed(router)` |
| The stock asset is enabled | `AssetNotEnabled(stock)` |
| The issuer has not paused the stock | `TokenPaused(stock)`, or `PauseCheckFailed` if the pause state cannot be read |
| The multiplier can be read and is nonzero (Feed assets must be seeded and fresh) | `MultiplierUnavailable`, `FeedNotSeeded`, `FeedStale` |

The pause check **fails closed**: a manager that reverts, returns the wrong size, or a token that reports no manager makes the swap revert instead of passing.

## The sequence

```text
tokenIn.safeTransferFrom(caller, guard, amountIn)
tokenIn.forceApprove(approveTarget, amountIn)         // exact
(ok, ret) = router.call(routerData)                    // the aggregator's calldata
tokenIn.forceApprove(approveTarget, 0)                 // reset
out    = stock.balanceOf(guard) - stockBefore          // what actually arrived
shares = out * multiplier / 1e18
require(shares >= minShares)                           // InsufficientShares otherwise
stock.safeTransfer(recipient, out)
refund any unspent tokenIn to the caller
emit Guarded(...)
```

`routerData` was built by the aggregator with the guard as the buyer, which is why the guard can run it as its own transaction.

## The event

```solidity
event Guarded(
    address indexed user,
    address indexed recipient,
    address indexed stock,
    address tokenIn,
    uint256 amountIn,
    uint256 tokensOut,
    uint256 shares,
    uint256 multiplier,
    address router
);
```

The receipt page decodes this event: what was spent, how many tokens arrived, how many shares they were worth at which multiplier. That is the proof, and it is on-chain.

## Failure modes seen in practice

| Symptom | Cause |
|---|---|
| `InsufficientShares(shares, minShares)` | The fill landed below the floor. Nothing is spent but the network fee. |
| `RouterCallFailed(reason)` | The router reverted. A market-maker order that expired inside the block shows `RFQ_OrderExpired` in the nested reason. |
| `FailedInnerCall()` (`0x1425ea42`) from the aggregator | The swap ran out of gas. The API's gas figure is a placeholder (always 450,000); real routes used 437,968 to 1,024,000. Tally estimates and simulates at the exact limit it sends. |
| `TokenPaused(stock)` | The issuer paused the token, for example around a session change. |
