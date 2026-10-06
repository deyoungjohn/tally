# V-AW live test: one unattended sell through `baw` (2026-10-06)

Run by the chief engineer on their own Agentic Wallet with `live-sell-test.sh … sell` (the user typed both confirmations). Sell of NVDAB for USDT on BSC through the LiquidMesh router, calldata from `engine.trade.prepareSell`, sent with `baw contract-call preview` then `execute`.

- Developer Mode on, daily limit $1,000, `requireConfirmation=false`, token whitelist active.
- Approval: `approve(router, exactly 25369457052295326)` executed, **developerModeQuotaUsed stayed 0**.
- Sell: preview and execute both exit 0; execute took 1 s; **no Binance App tap**. Hash `0xfb0c37113d0fb8d815d074787381cedea54ea744d9bc6450d3bf7d28c7083aac`.
- Quota after the sell: **developerModeQuotaUsed = 6.1084** (the sale's USD value; the main trading pool was untouched).
- Balances: USDT 4.1494 → 10.2494 (+6.0999); NVDAB 0.02544 → 0.00005 (0.2% left as dust by design); BNB 0.006341 → 0.006273 (about $0.05 gas).
- The `baw` balance was 0.08% higher than the chain's for this rebasing token, so the plan came back `needs_funds` until the amount was sized from the chain balance.

Raw `RESULT.txt` lines were pasted into the review session; no secrets are in them.

## Verdict

V-AW passes for the path that matters: **a bounded, unattended sell executes through `baw contract-call` with no tap, counts against the Developer Mode quota, and the approval does not.** Not proven: refusal at a cap (Binance's lowest daily limits are $1,000 DEX/Developer Mode, $5,000 DeFi/prediction, $20 x402, so it cannot be tested with small money). Tally's own per-trade and daily caps in `decide` are therefore the real limit, and the wallet cap is only a backstop.
