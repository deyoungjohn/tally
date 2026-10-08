# WO-13 receipt: fixes from review (PR 48)

Same worktree and branch, no new branch; push to the open PR. Full detail is in your PR's review; each item needs a test.

1. Sale simulation: stop hard-coding `simulation: false`. Use the sale plan's real simulation result, or null so the receipt says "Not recorded". Never default to yes or no.
2. Permalink protection: pass the buy floor from the `Guarded` event (min shares); the sale floor is not on chain, so show "Not recorded on chain". No "Pending" on a verified page.
3. Source shares: use the on-chain multiplier at the sale's block (archive read via the engine's chain client), not today's API reading. If it cannot be read, show "shares unavailable" and no share difference. Prefer on-chain over API/list everywhere in this loader.
4. Sale parse: require exactly one registry stock token transferred from the sender in the sale; anything else is "not a Migrate".
5. Dollar difference: define it once as USDT delivered by the sale minus USDT spent by the buy (bigint, 18 decimals), with gas fees listed separately and only when both are known. The modal and the permalink must show the same number for the same pair.
6. UI and tests: render the Copy button on the server and client alike (no `typeof window` branch), give feedback ("Link copied") and use the native share sheet where it exists; use the orange tokens, not Tailwind orange; detect fixtures the way the other receipts do, not by `0xf1`. An RPC failure shows the degraded state, not "not a Migrate". Add: VM tests (conserved, down, up, missing multiplier, unverified leg, old stored shape), a valid-pair permalink test in the loader, and an e2e of a valid permalink at 375 / 768 / 1280 with reduced motion and the share control copying the exact URL.
