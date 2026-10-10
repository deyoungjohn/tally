# Adding assets

Enabling a token on the deployed ShareGuard is an **owner-only** action (`setAsset`). Tally does it in pinned, evidence-checked batches. This page describes the gates; the commands the owner runs are in the repository's [deployment guide](https://github.com/deyoungjohn/tally/blob/main/docs/deployment.md), the single source for operational steps.

## The gates a token must pass

1. **On-chain facts.** The token is a real contract, exposes its multiplier source (bStock) or can be seeded (Ondo), answers its pause check, and is not paused.
2. **Depth capture.** A recorder captures real quotes from the Seoul server at $6 for every token and also $100 for bStock, for both the plain wallet and the guard as the buyer. Each must return a replayable swap, and the **premium against an independent reference price must be at most 1.5%**. The reference is the per-share price from the issuer-independent source the engine uses; a DEX price is never used to check a DEX quote.
3. **Fork tests A to I** on the capture, pinned to its block.
4. **A pinned manifest.** The owner script contains the hash of its manifest and checks every evidence file against recorded SHA-256 values before it does anything. It refuses a token outside the manifest, a held token, and a control token.
5. **A keyless preview** on a local fork of live state, then a dry run, then the owner's broadcast.
6. **A read-only verification afterwards:** the exact configuration, a nonzero multiplier, not paused.
7. **A live $6 proof** per issuer type on mainnet, with the `Guarded` event checked against the chain.

## What the script refuses

* A token already configured, including a disabled one: it is skipped, never re-seeded.
* A batch larger than ten.
* An Ondo seed older than two hours or from the future.
* Anything while the guard is paused or on another chain.

## Rollback

`rollback(stock)` sets `enabled = false` and preserves the rest of the configuration and the feed. It is limited to the assets in the manifest.

## Why the gates are strict

An earlier version of the depth gate used only a per-token reference price from a truncated list and rejected tokens that were fine. A later version used the engine's ticker-level reference and rescued six of them. The lesson is in [Challenges](../building-tally/challenges.md): a gate that rejects good tokens costs a feature, and a gate that accepts bad ones costs money, so each gate records its reason.
