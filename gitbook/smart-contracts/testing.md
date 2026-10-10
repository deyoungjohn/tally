# Testing

ShareGuard was not deployed until three layers of tests passed.

## Unit and fuzz tests (offline)

72 tests across swap, admin, feed and signature suites, plus 17 more for the asset-addition script. They cover swap maths, the exact minimum, refund and no residue, router and approve-target rules, pause checks (including a manager that reverts), feed bounds, monotonic replay, staleness, corporate actions, EIP-712 signatures, ownership transfer, rescue, reentrancy and the EIP-7702 batch helper.

Six **fuzz properties** run at 512 iterations each:

| Property | What it asserts |
|---|---|
| Shares match the multiplier maths | For multipliers between 1e15 and 1e20, shares equal `out × m / 1e18`. |
| The minimum is exact | A fill exactly at the floor passes; one unit below reverts. |
| Refund and no residue | Unspent input is returned and the guard keeps nothing. |
| Tolerance | Any fill above the minimum is accepted. |
| The feed bound is exact | An update inside the step is accepted and one outside is rejected, for any step setting. |
| Only allow-listed routers are called | Whatever address and data an attacker supplies. |

A Python-signed EIP-712 update (the same code the server uses) is verified by the contract in a test, so the signer and the contract agree on the typed data.

## Mainnet-fork tests (A to I)

The fork tests replay **real aggregator calldata** recorded from the Seoul server against a fork of live BNB Chain, pinned to the capture's block with an archive RPC, so they replay deterministically days later without a Binance key.

| Test | What it proves |
|---|---|
| A | The aggregator's calldata works as a plain wallet transaction, and what arrives matches the quote. |
| B | **ShareGuard as the trader works** with real routes. Includes the `Guarded` event, a zero approval afterwards and an empty guard. |
| B2 | The same with a signed Ondo feed update. |
| C | A share shortfall reverts. |
| D | An EIP-7702 batch (approve, unchanged swap, share check) works for wallets that support batching. |
| E | A failed share check in that batch undoes the swap atomically. |
| F | The route fits **our** gas limit, not the API's 450,000. The test says so when it does not. |
| G | **The arbitrary-call attack reverts.** It runs the prototype's swap logic against real USDT and the real stock. |
| H | A paused token reverts, and a pause manager that reverts fails closed. |
| I | A stale or out-of-bounds Ondo feed update reverts. |

Tests B2 and I apply to Ondo assets only and are skipped for bStock.

{% hint style="info" %}
Test G corrected our own threat model. The attack as first written (`tokenIn = USDT`, `router = USDT`, `data = transferFrom(victim, attacker, X)`) reverts in the prototype on its own "no output" check, because the stock balance does not move. The working exploit sets `tokenIn` to the **stock** (the attacker pulls a dust amount, which the output check then counts as output) with `router = USDT`, and drains the victim's whole approved USDT balance in one call. ShareGuard v1 stops every variant three ways: the router must be allow-listed, `tokenIn == stock` reverts, and a router or approve target can never be a configured stock token. The test asserts the victim keeps every token.
{% endhint %}

## Why the gas test exists

The first live buy reverted out of gas. The aggregator's calldata and the fork tests were fine, but the transaction was sent with the API's placeholder gas of 450,000, and Foundry does not cap gas, so tests A to E passed. Test F was added to catch exactly that, and the engine now simulates at the exact limit it sends. See [Challenges](../building-tally/challenges.md#the-api-says-450000-gas-the-route-needs-775639).

## Running them

Instructions for running the suites are in the [contracts README](https://github.com/deyoungjohn/tally/blob/main/contracts/README.md): `forge test` runs the offline suites, and `./script/fork.sh` replays every capture on a fork with an archive RPC.
