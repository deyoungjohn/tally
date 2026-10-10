# Autopilot (shadow mode)

Autopilot is the idea of an agent that acts on a Guardian alert for you, within limits you set. Only the safe half is built: it decides, records the decision and **executes nothing**.

## What exists

* **A policy** per wallet: a kill switch that defaults to **on**, a per-trade cap, a daily cap and an allow-list of tokens it may act on. Caps are validated and **rejected, not clamped**: the maximum accepted is $100 per trade and $250 per day. The allow-list holds at most ten registry-listed, executable tokens whose decimals are exactly 18.
* **`decide`:** a pure function that takes an alert, the wallet's position and the policy and returns an action or the reasons it refuses ("kill switch on", "cap reached", "position unknown", an alert or a position older than 60 seconds). Facts it cannot establish are treated as unknown, never assumed.
* **A decision log**, protected from pruning, that records every decision and its reasons.
* **A position collector** inside the `autopilot` worker that keeps the wallet's token positions fresh.
* **A preview page** (`/dev/autopilot`, behind a flag) that shows policy, positions and decisions.

## What does not exist

The executor. Nothing sells, nothing signs, no key is held. See the [roadmap](../reference/roadmap.md).

## What we proved about the execution path

An unattended sale is possible with Binance's Agentic Wallet. On 6 October, a sale of NVDAB for USDT ran through `baw contract-call preview` and `execute` with **no tap in the Binance app**. The approval did not count against the Developer Mode quota; the sale counted its USD value (6.1084). Binance's minimum daily limits ($1,000 for Developer Mode) made a cap-refusal test impossible, so Tally's own caps in `decide` are the real safety rail, not Binance's. The evidence is in `docs/evidence/V-AW-live-sell.md`.

{% hint style="warning" %}
Autopilot through `baw` works only for the owner's own Agentic Wallet. It is not a multi-user feature.
{% endhint %}
