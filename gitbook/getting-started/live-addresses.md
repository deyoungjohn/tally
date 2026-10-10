# Live addresses

All addresses are on **BNB Smart Chain mainnet (chain ID 56)**. Re-read token addresses from the registry at runtime; this page is for reference.

## Tally contract

| Name | Address |
|---|---|
| ShareGuard v1 | [`0x28F6F19bffbF25E36452c78d12090F0bC922970a`](https://bscscan.com/address/0x28f6f19bffbf25e36452c78d12090f0bc922970a) |
| Feed signer (Ondo multiplier updates) | `0xDd3C5F463d71fb06D7bE749F904A4090E080f407` |

ShareGuard was deployed on 2026-10-02 at block 125266385. The owner is the team's own wallet; the contract is `Ownable2Step`, pausable and not upgradeable. See [Deployments and enabled assets](../smart-contracts/deployments.md).

## Infrastructure Tally calls

| Name | Address |
|---|---|
| USDT (18 decimals) | [`0x55d398326f99059fF775485246999027B3197955`](https://bscscan.com/address/0x55d398326f99059ff775485246999027b3197955) |
| LiquidMesh router and approve target (Binance Web3 aggregator) | [`0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5`](https://bscscan.com/address/0xb44446b0c8e56988c34f7ff73ae904982b5fdda5) |
| bStock shared pause manager | `0x9fc74Be63f3589485B2423984a7a0557e0CF700a` |
| Ondo `tokenPauseManager()` | `0x6334924c787ebd21c881740ef6237ef51962638f` |

## Example tokens

| Token | Issuer | Address |
|---|---|---|
| NVDAB | bStock | `0x02fca66c1d1afb4e2a7884261eb00f63598a7436` |
| NVDAon | Ondo | `0xa9ee28c80f960b889dfbd1902055218cba016f75` |
| NVDAx | xStocks (data only) | `0xc845b2894dbddd03858fd2d643b4ef725fe0849d` |
| AAPLB | bStock | `0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a` |
| AAPLon | Ondo | `0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4` |

Token symbols follow one rule inside Tally: Ondo `on`, bStock `B`, xStocks `x` after the ticker (NVDAon, NVDAB, NVDAx).

## Selectors worth knowing

| Function | Selector |
|---|---|
| `uiMultiplier()` (bStock) | `0xa60bf13d` |
| `multiplier()` (xStocks) | `0x1b3ed722` |
| `isTokenPaused(address)` (pause managers) | `0x5e76ad54` |
| `FailedInnerCall()` (revert seen when a swap runs out of gas) | `0x1425ea42` |
