# The engine

Three packages do the thinking; `packages/engine` wires them together.

## `packages/core`: pure logic

No network, no clock, no randomness. It holds:

* **Share maths** in `bigint`: multiplier resolution, tokens to shares, floors.
* **The multiplier rules** and the Ondo sanity bounds ([Integrity grades](../concepts/integrity-grades.md)).
* **The integrity grade** and its log.
* **The gas model** calibrated from real fills.
* **A TTL cache** with a single shared promise per key, so concurrent callers never start two computations.
* **`consolidatedQuote`**, written against injected ports (registry, facts, quotes, chain). Tests pass fakes; production passes the real adapters.

## `packages/binance`: the API client

* **Signing:** every request is signed with the API secret and carries a timestamp. A clock more than the receive window away fails with `40103`.
* **Pacing:** a token bucket (burst 3, then 4 requests a second). The API answered `42900` after about 5 back-to-back calls from Seoul; the client retries rate-limit errors twice with backoff.
* **Errors:** the API sends errors as **HTTP 200** with a `code`. The client always checks the JSON code and maps 40301 to 40304 to one region-block kind.
* **Schemas:** zod, written from recordings of real responses. Two schemas written from the docs failed on real data, which is why recordings are the source of truth.
* **Fixtures:** a transport that replays recorded raw responses (`packages/binance/fixtures/raw/`, never edited). Fixture-mode engines replay "as of" the recording time, not the wall clock.

## `packages/chain`: BNB Chain access

* **viem with a failover transport.** A dedicated provider is tried first, then the configured fallbacks, then public endpoints. A provider that answers "daily request limit reached" (code `-32003`) is treated as a failed endpoint, not a rejected transaction. That distinction cost us a morning: viem's default failover gives up on `-32003`.
* **Reads:** multipliers (`uiMultiplier()`, `multiplier()`), balances, allowances, ShareGuard state.
* **`planGas`:** `eth_estimateGas` from the user × 1.25, then `simulateAtLimit` runs `eth_call` at that exact limit. We never use the API's gas number.

## `packages/engine`: wiring

* `engine.trade.prepare(...)` builds the buy plan. `engine.trade.prepareSell(...)` builds the sell plan. `engine.trade.receipt(...)` decodes the `Guarded` event.
* `engine.radar(...)`, `engine.portfolio(...)`, `engine.holdings(...)` build the live views.
* `engine.health()` reports Binance status, the RPC height, the guard's pause state and the age of the Ondo feed. A failed chain read reports why, with every URL removed.
* The CLI (`pnpm tally quote NVDA 25 --fixtures`) calls the same functions.

{% hint style="info" %}
Web, bot and MCP call `@tally/engine`. They must never rebuild the wiring: that is how three surfaces would end up disagreeing.
{% endhint %}
