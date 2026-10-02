# Ondo multipliers move in steps, not gradually

Measured by diffing the public Ondo token list (BSC) between `snapshot-2026-09-30/` (fetched 2026-09-30 19:35 UTC) and `snapshot-2026-10-02/` (fetched 2026-10-02).

- **31 of 458 tokens changed; every change is a single step**, stamped at a handful of update times (`lastUpdateTime` 10-01 00:02, 08:03 or 13:35 UTC; PBR 10-02 00:04).
- **No decreases.**
- **Largest step 0.58% (USHY).** Examples:
  - bond ETFs on their 1 October monthly distribution: HYG +0.40%, TLT +0.39%, AGG +0.34%, BIL +0.28%;
  - PBR +0.50%.
- **Most tokens' `lastUpdateTime` is days or weeks old** (09-15, 08-14, …), so updates happen only at dividend events.

**Consequence for bounds** (`TALLY_BLUEPRINT.md` §7.3):
- A per-day rate cap ("growth ≤ yield ÷ 365 per day") would have rejected all 31 legitimate updates. HYG at ~5.8% yield allows about 0.016% per day, but stepped 0.40%.
- Bounds must be per step:
  - never decreases (except a matching corporate action);
  - a single step ≤ 3% is accepted;
  - above 3% needs a corporate action.

The "PFE ≈ +1.5% per quarterly step" figure is an estimate (≈6% yield ÷ 4), not observed. The largest observed step so far is 0.58%.

Reverse splits do produce decreases: SOXS (Ondo) has a multiplier of 0.1017 in the 09-30 snapshot.

Reproduce: run `research/fetch_snapshot.py` on two dates and diff the `multiplier` field by `contractAddress`.
