# BNB Hack: Tokenized Stocks Edition: two ideas, backed by data

> **Naming:** the idea called **Parity** below is now **Tally**. This document is the ideation and validation record carried over from [deyoungjohn/find-out](https://github.com/deyoungjohn/find-out); the build plan is `TALLY_BLUEPRINT.md`.

> **TL;DR**
>
> | | **Idea 1: TALLY** | **Idea 2: STIPEND** |
> |---|---|---|
> | One line | *Shares, not tokens.* A best-execution layer that converts Ondo, bStock and xStocks into real share units, sends each order to the issuer with the best true price, and blocks trades that fall into data traps. | *The AI wealth manager paid only from your dividends.* An Agent Studio agent whose entire income is a capped cut of dividends, measured on-chain from share multipliers and enforced by a vault contract. |
> | Blind spot it attacks | Unit of account and data integrity. The same ticker means 10× different amounts of stock depending on the issuer, and the APIs disagree with the chain. | Nobody uses the multiplier as a dividend ledger. It tracks dividend yield at **r = 0.917**. |
> | Special prize it targets | Best Use of Agentic Wallet / Wallet Skills | Best Use of BNB Agent Studio (identity, runtime, **self-funding via x402**) |
> | Pattern from past winners it uses | Precise financial primitive + upstream fix to the sponsor's own tooling (Meld, PRECEDENCE, Tilt) | AI bounded by on-chain policy + paid x402 calls + verifiable profit and loss (Faktura, Flattora, Watchdog, Infinite Money Glitch) |
>
> Both ideas avoid the weekend-gap idea completely. Both are spot-only and run on BSC mainnet.

---

## 1. What 87 past winners tell us

Source: `projects.jsonl` / `hackathons.jsonl` (15 hackathons, Jan–Sep 2026). Reproduce with `python3 research/analyze_winners.py`.

| Signal | Data | What it means for us |
|---|---|---|
| The sponsor's stack carries real weight | 77/77 winners with a known rating used sponsor tech as **load-bearing** | Every Binance module we touch has to do real work. No logo integrations. |
| Evidence you can verify | **57%** of winners (50/87) are built around receipts, proofs, attestations or audit trails. It shows up in 7 first-place projects. | On-chain guards and receipts beat dashboards. |
| AI bounded by on-chain policy | **29%** of winners, including **4 first places** (Faktura, Watchdog, Flattora, GATE402) | The LLM proposes and the contract decides. |
| RWA precision wins | RWA was only 7% of winners, but 2 of those 6 took **1st** (Faktura, Tilt Protocol). PRECEDENCE took 3rd as "an unusually precise financial primitive". | Precise primitives beat generic "AI trader" projects. |
| Generic agent marketplaces and escrow | 9% of winners, **zero** first places | Avoid. |
| Generic trading or portfolio agents | ATLAS, ORCA and Sui Jarvis all placed 3rd–4th | "AI that trades" on its own doesn't take 1st. |
| Fixing the sponsor's own tool | Meld won **1st** at KeeperHub by finding waste in the sponsor's workflows and shipping an upstream fix | This hackathon weights the DX report at **25%**. Real bugs plus a PR to Binance's repo hit that directly. |
| Most winners start fresh | 74/87 had no commits before the event | Starting now is normal. |

## 2. What the live market says (snapshot 2026-09-30 19:35 UTC, US regular session)

Pulled from the same public endpoints the Binance skills use, plus BSC RPC. Raw JSON is in `research/snapshot-2026-09-30/`. Reproduce with `python3 research/fetch_snapshot.py && python3 research/analyze_snapshot.py`.

1. **A token is not a share, and each issuer uses different units.** BSC has 517 tokenized tickers: 458 Ondo, 87 bStock, 130 xStocks. 38 tickers are listed by all three issuers and 120 by at least two. 242 of the 458 Ondo tokens have a multiplier other than 1.
   - `NFLX`: Ondo **10.0** shares per token, bStock 1.0, xStocks 1.0 in the list API. The xStocks dynamic API says 10.0.
   - `CRWD`: Ondo **4.0**. `SOXS`: Ondo **0.1017** (reverse split).
2. **The API disagrees with itself and with the chain.** For NVDAx, the list API says the multiplier is `1.000000`, the dynamic API says `1.000918`, and the token contract's on-chain `multiplier()` says `1.001701`. That's three answers for one token. 17 of 103 issuer–ticker pairs disagree between list and dynamic. On-chain vs dynamic, 12 of 38 xStocks tokens disagree, while bStock matches in 38 of 38.
3. **The obvious cross-issuer "arbitrage" is an illusion.** Compare raw token prices and you see gaps of 899% (NFLX), 869% (GME), 713% (MRVL) and 563% (IBM). Normalize to share units against the US reference price and the gaps disappear:
   - Ondo: median **+0.004%**, mean |premium| 0.046%
   - bStock: median **+0.062%**, mean |premium| 0.072%
   - xStocks on BSC: median −1.17%, with outliers of −90% / +865%. These are **stale marks on a ghost market.**
4. **Trading is concentrated in one issuer.** 24h on-chain volume across the 38 triple-listed tickers: **bStock $48.3M, Ondo $4.3M, xStocks $96.** A naive arbitrage bot would buy into those $96 pools.
5. **The metadata has gaps.**
   - Only Ondo returns `marketStatus`. bStock and xStocks return `null` for all 38.
   - `liquidity` reads $0 for almost every token, yet NVDAB made ~2,968 transfers in 22 minutes through router contracts (LI.FI, CoW settlement).
   - bStock exposes `uiMultiplier()` on-chain. xStocks exposes `multiplier()`. Ondo exposes **no** on-chain multiplier, but does expose `compliance()` and `tokenPauseManager()`.
6. **The multiplier is a dividend ledger.** Across 26 Ondo tokens on BSC, multiplier growth tracks the stock's dividend yield with **Pearson r = 0.917**. Examples: PFE +6.09% multiplier vs 5.98% yield, KO +2.39% vs 2.95%, TSLA and AMZN 0.00% vs 0%. Dividends are silently reinvested, users never see them, and they can be measured on-chain.

**What this means:** this month's baskets, DCA bots, rebalancers, spread monitors and "AI traders" will mostly read raw `price` and assume one token equals one share. The biggest hidden risk in this asset class right now is not the weekend gap. It's **wrong units and bad data.** Both ideas are built on that finding.

> ⚠️ Verify on day one with your API key: the authenticated RWA Data API docs describe `referencePrice` as *"per-share converted price derived from on-chain token price"*. If that's literally true, then every "on-chain vs reference spread" monitor (one of the suggested ideas) is comparing the token price with itself. The real underlying price we used is `stockInfo.price` from the public dynamic endpoint.

## 3. Where the crowd will be

The track page lists 10 example ideas, and most entries will cluster around them. We mapped each to our view:

| Crowded cluster | Our read |
|---|---|
| Weekend gap / market-hours arb / reference-spread monitor | Excluded on purpose. The data above also shows the spread signal is mostly a units problem. |
| Cross-protocol arb (bStock vs Ondo) | In share units it's ≤0.1% during market hours. The big "gaps" are traps. **Tally turns this idea into a safety product.** |
| NL strategy agent / earnings agent / TradFi-crypto rebalancer | These will look alike and be judged on build quality. **Stipend gives an agent a business model and on-chain limits.** |
| DCA / thematic baskets / "first stock" onboarding | Consumer UX will be crowded. Tally's "buy in shares" flow stands out because the units are actually correct. |
| MCP / SDK wrapper | Wrappers are commodities. Tally's MCP server is useful because it's a **correctness layer**, not a wrapper. |

---

## Idea 1: TALLY: "Shares, not tokens."

### The pitch
Robinhood users think in shares and dollars, and they expect best execution. On-chain they get three issuers, each with its own units, disagreeing metadata and ghost pools. Tally is the **consolidated tape and share-true order router for tokenized equities on BSC**. You say "buy half a share of NVDA" or "$50 of Apple". Tally quotes every issuer in real share units, picks the best true price, and settles through an on-chain guard that reverts if you'd get fewer **shares** than promised.

### Product surfaces
1. **Consumer app** (mobile-first; Binance Wallet / Agentic Wallet)
   - *Consolidated quote*: for each issuer, the true price per share (`price / multiplier`), price impact at your order size from a Trading API quote ladder (for example $10 / $100 / $1k), gas, trading status, attestation freshness (`protections` from underlying-profile), and an integrity grade. One button.
   - *Receipt in shares*: "You own **0.4998 NVDA** (via NVDAB) · paid +0.06% vs NYSE last."
   - *Portfolio in shares across issuers*: "1.73 AAPL = 1.20 via AAPLon + 0.53 via AAPLB". Dividends are shown as shares received, taken from multiplier growth.
2. **ShareGuard** (Solidity, BSC mainnet)
   - `swapForShares(route, stockToken, minSharesOut, maxPremiumBps, signedRef)`: runs the aggregator calldata from the Trading API, then asserts `Δbalance × multiplier(stockToken) ≥ minSharesOut`. This is **slippage protection measured in shares**, not tokens. As far as we can find, no DEX router offers it.
   - `MultiplierRegistry` adapters: bStock → `uiMultiplier()`, xStocks → `multiplier()`, Ondo → signed feed. The Ondo feed only increases, except for registered split events, and each change is capped by the expected dividend.
   - Reverts when the issuer's pause manager reports a pause, or when the signed reference price shows a premium above `maxPremiumBps`.
   - Execution: a pull-through router, or an EIP-7702 batch so a normal wallet can swap and assert in one transaction.
3. **Trap Shield / Integrity Score** per issuer and ticker:
   - multiplier agreement across list API, dynamic API and on-chain
   - premium vs `stockInfo.price` during regular hours
   - on-chain transfers and volume in the last 24h
   - whether the token has status coverage
   - age of the latest attestation report

   Graded A–F and shown in the app and API. The NVDAx 3-way mismatch and the $96 xStocks market are the live demo.
4. **Agent surfaces** (Wallet Skills special)
   - `share-true-trading` skill in the `binance-skills-hub` format. It sits in front of `baw market-order quote/swap`: resolve ticker → pick issuer → convert shares to amount → check integrity → confirm. ShareGuard is called through `baw contract-call preview/execute` (dev mode), with previews shown to the user.
   - MCP server with `consolidated_quote`, `shares_of(address)`, `integrity(ticker)` and `route(ticker, shares)`.
   - A **b402 pay-per-call** endpoint, so other hackathon agents can pay Tally to avoid unit mistakes.
5. **Upstream PR to `binance/binance-skills-hub`**, following Meld's approach. The `binance-tokenized-securities-info` skill still says Ondo is "currently the only supported tokenized stock provider", while `binance-agentic-wallet` documents `type=1/2/3`. The PR adds the multiplier source-of-truth rules and the xStocks and bStock cases.

### How each Binance module is used
| Module | Role in Tally |
|---|---|
| RWA Data API | Token and issuer lists, `tokenToShareRatio`, `protections` (attestation and collateral URLs), `statusInfo` and corporate-action reasons, underlying market data |
| Market API | Candles and real-time prices for the crypto leg (pay in BNB or USDT) and for sanity bands |
| Trading API | Quote ladder at several sizes per issuer (the actual price-impact curve), swap calldata, approvals, MEV protection |
| Transaction API | **Every route is simulated before it's shown.** Failed simulations lower the integrity grade. Broadcast. |
| Wallet API | Balances → portfolio in shares |
| b402 | Paid integrity and quote endpoint for other agents |
| Agentic Wallet / Skills | The `share-true-trading` skill, and `contract-call` for ShareGuard |
| BSC | ShareGuard, MultiplierRegistry, and live trades of a few dollars across ≥2 issuers |

### Why it wins
- **Technical (30%)**: uses all modules, a contract that enforces a new invariant, three multiplier sources reconciled, and fork tests against real tokens.
- **Creativity (25%)**: takes the suggested "cross-protocol arb" and shows with data that it's a trap. Share-denominated slippage is a new primitive.
- **DX report (25%)**: every bug Tally catches is a finding the judges asked for (see §DX). The upstream PR proves it.
- **UX (20%)**: shares, dollars and best execution are concepts non-crypto users already know. That's the "head to head with Web2" the brief asks for.

### 4-minute demo
1. Hook (0:00): "Is one NFLX token one Netflix share?" Ondo 10.0 / bStock 1.0. A naive bot shows GME **+869% arb**.
2. Tally (0:40): the consolidated quote shows the real gap is +0.06%, and xStocks is flagged as a ghost market.
3. Buy (1:30): "$5 of NVDA" → routes to bStock. ShareGuard transaction on BscTrace. Receipt in shares.
4. Protection (2:20): a ShareGuard **revert** when the signed premium exceeds the bound (dry-run through the Transaction API).
5. Agent (3:00): in Claude Code with the skill: "buy half a share of Apple, cheapest issuer". Previews, then executes.
6. Close (3:40): portfolio in shares, with dividends shown as shares. Link to the upstream PR.

---

## Idea 2: STIPEND: "An AI wealth manager paid only from your dividends."

### The pitch
Robo-advisors charge 0.25–1% a year **out of your principal**, whether or not they add value. On BSC, dividends are silently reinvested into each token's multiplier, which makes them **measurable on-chain income**. Stipend is a vault plus an Agent Studio agent:
- The agent manages your tokenized stock portfolio under rules the contract enforces.
- **Its only income is a capped share of the dividends your holdings actually earned.** It can never touch principal.
- It pays for its own data and inference (x402/b402) out of that income, and publishes an on-chain salary slip. If it's not worth its keep, it runs out of money where everyone can see it.

### Mechanics
- **StipendVault** (per user; holds allowlisted Ondo, bStock and xStocks tokens)
  - Share-equivalent holdings: `shares = tokens × m`. Dividend accrual since the last checkpoint: `Δshares = tokens × (m_now − m_last)`.
  - The agent can claim `feeBps × Δshares`, converted to tokens `= feeBps × tokens × (m_now − m_last) / m_now`. The claim is sold through the Trading API into the agent's wallet.
  - **Split firewall**: a naive version of this formula would treat NFLX's 1 → 10 multiplier as a 900% "dividend". At a 30% fee it would hand the agent **27% of your whole position in one claim** (`0.3 × 9/10`). Any multiplier jump above a band (for example 3% per update) is held out of income. It needs a registered corporate action (`stock_split` in `statusInfo.reasonMsg`) and a timelock. That demo line tells judges we did the math.
  - Agent actions go through `execute(route)` and must satisfy these checks:
    - share-true value after the trade ≥ value before × (1 − maxSlippage)
    - allowlisted tokens only
    - daily turnover cap
    - no trading while `ASSET_PAUSED`, and none while `ASSET_LIMITED (earnings)` unless the mandate allows it
    - concentration caps
  - The user keeps withdraw-all and a kill switch. The agent holds only a session key.
- **Multiplier oracle**: bStock and xStocks are read on-chain. Ondo updates are signed by a keeper, **bounded by `dividendYield × Δt`**, timelocked 24h, and the user can veto. The agent can't raise its own pay.
- **Agent (BNB Agent Studio)**
  - **ERC-8004 identity**, and a reputation feed covering tracking error vs mandate, fees taken and turnover.
  - **ERC-8183 task interface**, so users hire it with tasks like "set my mandate", "rebalance" or "explain this quarter".
  - Autonomous runtime.
  - **Pays for itself via x402/b402**: buys market data and inference, and posts a monthly on-chain "salary slip" with income, costs and runway.
- **Mandates in plain English, turned into on-chain policy**. For example, "60% dividend payers, 30% QQQ, 10% BNB, never >10% in one name" is compiled into vault constraints. The LLM writes the rules and the contract enforces them. This is the Faktura / Flattora pattern.
- **Issuer choice**: rebalances go to the issuer with the best share-true price. Because multiplier math is built in, a split can't confuse drift calculations.

### Honest economics (shown in the app as "break-even AUM")
Assume a portfolio yielding about 4.5% (PFE 5.98%, VZ 6%, T 4.7%, PEP 4.45%, CVX 3.42% from the snapshot) and a 30% stipend:

| Portfolio | Dividends/yr | Agent income/yr | ≈ x402 calls/day at $0.001 |
|---|---|---|---|
| $1,000 | $45 | $13.50 | ~37 |
| $10,000 | $450 | $135 | ~370 |
| $50,000 | $2,250 | $675 | ~1,850 |

A lean agent (daily checks plus a weekly LLM review) can live on $1.10 a month. Say this openly. Judges reward honesty, and the break-even curve *is* the product insight.

### Beyond agents
The same contract can pay the stipend to a **person** instead of an agent. For example, a diaspora family funds a dividend portfolio that streams income home as USDT while the principal stays invested. Mention this in one slide as the general version.

### How each Binance module is used
| Module | Role in Stipend |
|---|---|
| RWA Data API | Multipliers, `dividendYield` (oracle bands), `statusInfo` corporate actions (split firewall, pause rules), attestations |
| Market API | Drift and volatility inputs, crypto leg |
| Trading API | Rebalances and converting stipend to USDT, MEV-protected |
| Transaction API | Simulate every agent action against vault invariants before signing |
| Wallet / DeFi API | Portfolio state. Optionally, the agent parks its own USDT float in a BSC Earn position. |
| b402 / x402 | The agent's spending, which is the "self-funding" in the Agent Studio criteria |
| Agent Studio | ERC-8004 identity, ERC-8183 tasks, managed runtime, auto-registered MCP |
| Agentic Wallet | Agent key with daily limits, and `contract-call` into the vault |

### Why it wins
- **Agent Studio special**: "self-funding via x402" isn't bolted on. It's the business model.
- **Creativity (25%)**: nobody else treats the multiplier as income. r = 0.917 makes the claim concrete.
- **Technical (30%)**: vault invariants, a bounded oracle, a split firewall, and an agent that can't pay itself more.
- **UX (20%)**: "It only gets paid when your stocks pay you" makes sense to anyone who has seen a robo-advisor fee.

### 4-minute demo
1. Hook (0:00): "Your tokenized stocks paid you dividends this year. Did you notice?" Show the PFE multiplier at 1.0609.
2. Hire (0:40): hire the agent through an ERC-8183 task, then write a plain-English mandate. Show the compiled policy.
3. Deposit (1:30): a few dollars of dividend payers go into the vault on mainnet, with a live rebalance.
4. Salary slip (2:20): dividend accrual → the agent claims its capped cut → pays x402 for data. Runway meter.
5. Attack (3:00): simulate a 10× split. The naive formula would pay the agent 27% of your position in one claim, and the firewall holds it. Then the user kill-switch.

---

## Head to head, and a recommendation

These are subjective estimates against the published rubric:

| Criterion (weight) | Tally | Stipend |
|---|---|---|
| Technical (30%) | 9 | 9 |
| Creativity (25%) | 8 | 9.5 |
| DX report (25%) | 10 | 8.5 |
| Product & UX (20%) | 9 | 7.5 |
| **Weighted** | **9.0** | **8.7** |
| Special prize | Wallet Skills | Agent Studio |

**Recommendation:** make **Tally** the entry if you want the highest expected placement. It has more certain UX, and the DX report comes naturally from building it. If you'd rather chase the higher ceiling and the Agent Studio special, submit **Stipend and build Tally's share-math core first as its internal engine** (`MultiplierRegistry` + integrity checks). Stipend needs that core anyway, and the split firewall depends on it.

## Execution plan (in order; the deadline is deliberately left out)

| Phase | Tally | Stipend |
|---|---|---|
| P0: Truth layer | Ingest the 3 issuers; multiplier adapters (on-chain + API); integrity scoring; snapshot store | Same core; add the dividend-accrual ledger and split detection |
| P1: Quotes and simulation | Trading API quote ladder per issuer; Transaction API simulation of each route; consolidated quote | Simulate agent actions against vault invariants |
| P2: Contracts | `ShareGuard` + `MultiplierRegistry`; Foundry **BSC mainnet-fork** tests using real NVDAB/NVDAon/NVDAx; deploy; $2–5 live trades on ≥2 issuers | `StipendVault` + bounded oracle + split firewall; fork tests including a synthetic 10× split; deploy; small live deposit |
| P3: Product | "Buy in shares" flow, portfolio in shares, Trap Shield | Mandate → policy compiler, salary slip, runway meter, kill switch |
| P4: Agent layer | Wallet Skill, MCP, b402 endpoint, upstream PR | Agent Studio deploy (ERC-8004/8183), x402 spending, reputation feed |
| P5: Proof | Demo video, BscTrace links, DX report | Same |

### Feasibility checks already done
- **The token layer does not block contracts.** On 2026-09-30, `research/transfer_check.py` simulated real holders sending NVDAon, NVDAB and NVDAx to a brand-new wallet and to a brand-new contract. All six transfers passed, and an overdraw control reverted as expected. All three issuers use a **blocklist/sanctions model** (Ondo: `isBlocked`/`isSanctioned` via `compliance()`; bStock: `addToBlocklist`/`sanctionedAddresses`; xStocks: `sanctionsList()` + `isPaused()`), not an allowlist of approved holders. Any address can hold unless it is listed. Re-run the script before deploying, because the lists can change.
- **The real gate is off-chain eligibility, not the contract.** Issuers push geographic and eligibility enforcement onto the app offering the product. The bStocks FAQ expects a country-eligibility API that isn't publicly documented. xStocks puts KYC and geography on the venue. Ondo attaches eligibility representations to secondary buyers, and redemption requires issuer KYC. See "Eligibility" below.
- On-chain multipliers can be read for bStock and xStocks. Ondo needs a feed. Its `tokenPauseManager()` exists, so pause checks can be done on-chain.
- The skill docs show `limit-order` returning `Ondo-related tokens cannot be traded`. Plan for market orders plus guards on Ondo.

### Eligibility: how each idea handles it
Transfers work, but an app that helps people buy these tokens takes on the issuer's user-eligibility duties. Neither idea can make that go away, so both are designed not to be a new distributor.
- **Tally**: execution goes through the user's own **Binance Web3 Wallet / Agentic Wallet and the Trading API**. The venue that already onboarded the user places the trade. Tally supplies the quote, the integrity grade and the ShareGuard check. Quotes, integrity scores and the MCP data need no eligibility at all. The app also blocks the hackathon's restricted regions itself. **Verified 2026-10-01 (see Findings §F3):** the Trading API enforces region by the **calling server's IP**, not by token or wallet. So Binance checks Tally's backend, not the end user, and blocking end users is Tally's job.
- **Stipend**: this is the more exposed of the two, because an agent managing someone's securities for a fee looks like investment management. Build it as a **policy module on the user's own smart account** (EIP-7702 / ERC-7579 session key) instead of a separate vault, so the tokens never leave the user's wallet and the agent only holds a capped, revocable key. Trades still go through the Binance wallet stack. For the hackathon, demo only with your own funds.
- **Both**: no issuer mint or redemption (that requires issuer KYC). Secondary-market only, small amounts from your own wallet, with the restricted-regions gate on.

## Findings: everything we've verified so far

This section is the project's lab notebook. Every claim has a date, how we got it, and where the raw evidence lives. Numbers are copied from tool output, not estimated. When a later finding corrected an earlier one, both are kept and the correction is marked.

**Evidence locations**
- `research/snapshot-2026-09-30/`: public-API and on-chain snapshot (§F1, §F2)
- `research/transfer_check.py`: compliance and transfer simulation (§F2)
- `research/region_check.py`: Trading API region runs. The team's raw reports stay off-repo because they contain wallet addresses (§F3).
- `spike/results/`: fork-test logs, route captures, live-buy JSON (§F4–§F7)
- On-chain transactions: BscScan links in §F6

### F1. Market data and units (2026-09-30, public endpoints + BSC RPC)
- **Universe on BSC:** 517 tokenized tickers: Ondo 458 tokens, bStock 87, xStocks 130. 38 tickers are listed by all three issuers and 120 by at least two.
- **A token is not a share, and issuers disagree on units.**
  - 242 of 458 Ondo BSC tokens have a share multiplier other than 1.
  - Split-adjusted examples: Ondo NFLX = 10.0 shares per token, CRWD = 4.0, SOXS = 0.1017. bStock and xStocks NFLX = 1.0.
  - Anyone comparing raw token prices sees fake cross-issuer "arbitrage": NFLX 899%, GME 869%, MRVL 713%, IBM 563%.
- **The same token's multiplier differs by source.** NVDAx: list API 1.000000, dynamic API 1.000918, token contract `multiplier()` 1.001701. List and dynamic disagree on 17 of 103 issuer–ticker pairs. On-chain vs dynamic: 12 of 38 xStocks tokens disagree, while bStock matches on 38 of 38.
- **Where the on-chain truth lives.** bStock exposes `uiMultiplier()`, xStocks exposes `multiplier()`, and Ondo exposes **no** on-chain multiplier (only the API's `sharesMultiplier`).
- **Share-true premiums in US regular hours are tiny for the two live issuers.** Ondo: median +0.004%, mean |premium| 0.046%. bStock: median +0.062%, mean |premium| 0.072%. xStocks on BSC: median −1.17%, with stale outliers from −90% to +865%.
- **Where volume is.** 24h on-chain volume across the 38 shared tickers: bStock $48.3M, Ondo $4.3M, xStocks $96. **xStocks on BSC is a ghost market** and should only appear in Tally as a "trap" example, never as an execution venue.
- **The multiplier records dividends.** Across 26 Ondo tokens, multiplier growth tracks dividend yield with Pearson r = 0.917 (e.g. PFE +6.09% vs 5.98% yield). This is the basis of Idea 2 (Stipend).
- **Metadata gaps:**
  - `marketStatus` is returned only for Ondo; `null` for bStock and xStocks.
  - `liquidity` reads $0 on tokens that make thousands of router transfers per hour.
  - `tokenInfo.volume24h` is the US stock's volume, not on-chain volume.
  - bStock's `stockInfo.price` is `null`, so a bStock reference price has to be borrowed from another issuer's token for the same ticker.

### F2. Token contracts and compliance (2026-09-30, `research/transfer_check.py`)
- **All three issuers use blocklists, not allowlists:**
  - Ondo: `compliance()` → `isBlocked` / `isSanctioned`, plus `tokenPauseManager()` with `isTokenPaused`.
  - bStock: `addToBlocklist` / `sanctionedAddresses` behind role-based access.
  - xStocks: `sanctionsList()` + `isPaused()`.
- **Contracts can hold and send these tokens.** Simulated transfers from real holders into a brand-new wallet and a brand-new contract passed for NVDAon, NVDAB and NVDAx (6/6), and an overdraw control reverted. Later, the fork tests and live buys proved this again with real routes (§F5, §F6).
- **The binding constraint is off-chain eligibility, not the contract.** Issuers make the app or venue responsible for geography and eligibility. Ondo attaches eligibility representations to secondary buyers, and issuer mint and redeem need KYC. Tally stays secondary-market only.

### F3. Trading API: who gets blocked (2026-10-01, `research/region_check.py`, five runs by the team)

| Run (UTC) | Caller IP | Wallet | Result |
|---|---|---|---|
| 10:19 | not recorded | fresh random | All 8 tokens quoted and swap transactions built |
| 10:30 | not recorded | team agent wallet | Same |
| 10:33 | Nigeria | team wallet | Same |
| 10:50 | **United States (VPN)** | fresh random | **Every call refused**, even `supported/chain`: `40304 "Service not available due to compliance restriction"`, sent as **HTTP 200** |
| 10:51 | Mexico (VPN) | fresh random | Same as Nigeria |
| ~12:30 | **South Korea (AWS Seoul EC2)** | test addresses | All captures succeeded |

UK and Canada VPN exits couldn't connect, so they're untested.

- **Region is enforced on the IP that calls the API, for the whole API.** It's not per token and not per wallet. A wallet with no history was served exactly like a real one.
- **Consequence 1: the backend must live in an allowed country.** AWS Seoul works. Avoid US regions, AWS London, DigitalOcean Amsterdam, Tokyo and Canada.
- **Consequence 2: Binance never sees Tally's end users.** The web app has to block the hackathon's restricted regions itself (an edge IP-country check plus a declaration). With Agentic Wallet / `baw`, calls come from the user's own machine, so Binance's own check applies.
- **The error design is a DX finding.** A compliance block that returns HTTP 200 passes any client that only checks status codes.

### F4. Trading API: quotes, routes and fees (2026-10-01, all runs)
- **One route, one vendor.** Every stock quote returned exactly one route from `LiquidMesh` via router/approve target `0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5`. BNB quotes sometimes added a second vendor (LI.FI, Pancake). For stocks the "aggregator" offers no comparison, so Tally has to quote each issuer's token itself.
- **Routes change minute to minute and cross other assets.** Observed NVDA routes, all for $5–$10 USDT:
  - One hop: `Metric:NVDAB`, `Elfomofi:NVDAB`, `Metric:NVDAon`.
  - Through another company's stock: `Elfomofi:SKHYB > Pancakeswap V4:NVDAB` (SK Hynix bStock).
  - Through crypto: `Biswap V2:BTCB > Topaz Cl:BSC_ETH > Genius:USDC > Uniswap V4:NVDAB` and `Uniswap V4:BTCB > Genius:USDC > Uniswap V4:NVDAB > Uniswap V4:NVDAon`.
  - **Through the other issuer:** many Ondo buys go through a Uniswap v4 NVDAB/NVDAon pool, so "buying Ondo" often means buying bStock first.
- **Ondo: documented as RFQ, behaves as a swap.** The docs describe Ondo as RFQ (EIP-712 signature + `order/submit`). In practice, a quote without a wallet fails with `40001 "userWalletAddress is required for RFQ (Ondo) quote"`. With a wallet, the API returned `executionMode: SWAP`, `rfq: null` in **every** run, pre-market (10:19–13:19 UTC) and in regular hours (13:46, 14:22–14:24 UTC). No RFQ order was ever required.
- **Ondo's minimum is 5 USD, checked in dollars.** 5 USDT was refused with `40375 "Minimum order amount is 5 USD."` (HTTP 200), because USDT is priced at ~$0.9995. 6 USDT always worked.
- **The API's gas number is a placeholder.** Every quote and swap returned `estimateGasFee: "450000"` and `tx.gas: 450000`, whatever the route. Real usage ranged from 437,968 to ~1,024,000 (§F6). `tradeFee` (~$0.02–0.04) matches 450,000 × gas price, so the displayed fee is also unreliable for long routes.
- **Default slippage is 1%** (`minReceiveAmount` = quote − 1%).
- **Prices are fair at small sizes, with one exception.** Fills landed within ±0.1% of the token's unit price on most routes. The exception is a 4-hop route through BTC and ETH, which cost +0.51% (§F7).

### F5. ShareGuard on a BSC mainnet fork with real API calldata (2026-10-01, `spike/`, run from AWS Seoul)
Method: `capture_route.py` takes a real quote and swap transaction for (a) a test wallet and (b) the fixed address where the test deploys ShareGuard. `forge test` then immediately replays both on a fork of live BSC. Offline unit tests: 9/9 pass.

| Test | What it proves | NVDAB (4 runs) | NVDAon (3 valid runs) |
|---|---|---|---|
| A: replay as plain wallet | API calldata works on the fork; received within 0.005% of quote | ✅ 4/4 | ✅ 3/3 |
| B: **ShareGuard as the trader** | A contract can trade the API's routes; shares checked on-chain | ✅ 4/4 | ✅ 3/3 |
| C: ShareGuard rejects a shortfall | A share-denominated minimum reverts a bad fill | ✅ 4/4 | ✅ 3/3 |
| D: EIP-7702 batch | Wallet runs approve → unchanged API swap → share check in one transaction | ✅ 4/4 | ✅ 3/3 |
| E: batch reverts atomically | A failed share check undoes the swap (fails at call index 2) | ✅ 4/4 | ✅ 3/3 |
| F: route fits the API's gas | Added after §F6's revert | ❌ 1/1 flagged (~703k needed vs 450k) | ❌ 1/1 flagged (~1.37M needed vs 450k) |

The two NVDAon runs at 5 USDT skipped (minimum, §F4) and aren't counted. F's gas figures are approximate: they include fork cold-access costs and a calldata upper bound. The point is direction, not exact numbers.

**Old captures don't replay.** Captures ~90 minutes old reverted on replay; a ~20-minute-old transaction still simulated. Quotes have a limited lifetime, so capture-then-replay must happen back to back. The live script re-quotes after the user confirms.

### F6. Live mainnet buys (2026-10-01, burner wallet `0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930`, from AWS Seoul)

| # | Block time (UTC) | Action | Result | Gas used / limit | Evidence |
|---|---|---|---|---|---|
| 1 | 14:08:39 | Approve 6 USDT to router | ✅ | 46,194 | [tx](https://bscscan.com/tx/0x6a8d334044e2dac39386dbad3fbf8a41b3b8477212fe6ac623dbe134db2af3da) |
| 2 | 14:09:48 | Swap 6 USDT → NVDAon (first script) | ❌ **reverted, out of gas** | 434,909 / 450,000 (API value) | [tx](https://bscscan.com/tx/0xfd7799e772868512799e7a114186a1778c506db765e0b54e05aa583f4481a40c) |
| 3 | 14:23:43 | Swap 6 USDT → NVDAB (fixed script; used approval #1) | ✅ | 437,968 / 698,076 | [tx](https://bscscan.com/tx/0x726aace915e720ca46f4cfb344a7283c4aa1ef59bde225fdea9796e2f0eb0ba7) |
| 4 | 14:24:21 | Approve 6 USDT to router | ✅ | 46,194 / 60,548 | [tx](https://bscscan.com/tx/0xa0398a478172679e30e03c6c09dfec9483466d6f7f3c7b95dfdb3802cb173e8e) |
| 5 | 14:24:25 | Swap 6 USDT → NVDAon (fixed script) | ✅ | 775,639 / 1,177,930 | [tx](https://bscscan.com/tx/0xb3ab17385d3872dfaec05367582739a10b08a9586861c56e02f1c2e264c49637) |

**Final wallet state:** 3 USDT, 0.025957 NVDAB, 0.026093 NVDAon, allowance 0. **Total gas for all five transactions: 0.000087 BNB (~$0.07)** at 0.05 gwei. No USDT was lost to the revert.

**What happened in #2.** The route was `Topaz Cl:BTCB > Genius:USDC > Uniswap V4:NVDAB > Uniswap V4:NVDAon`, sent with the API's `gas: 450000`. It reverted with `0x1425ea42` (OpenZeppelin `FailedInnerCall()`). Replaying it at the previous block: 450,000 → revert, 3,000,000 → success, `eth_estimateGas` → 1,024,328. Three things hid it:
- the dry-run `eth_call` had no gas cap;
- Foundry doesn't cap gas, so fork tests A–E passed;
- the swap was sent with the API's number.

Before #2, the script also crashed after #1 because `bsc-rpc.publicnode.com` began answering HTTP 403 to the EC2 box while the script was polling for the receipt.

**Fix, proven by #3 and #5.** The script now:
- re-quotes after the user confirms;
- sends `max(API gas, eth_estimateGas × 1.25)`;
- simulates at that exact limit before sending;
- saves the transaction hash before waiting;
- fails over across public RPCs.

Swap #5 used **775,639 gas: with the API's 450,000 it would have reverted again.** Swap #3 used 437,968, just under 450,000. So the API value fits short routes by luck, and `eth_estimateGas` overshot actual usage by ~21–27%, which is a safe margin.

**What the live fills show.**
- **NVDAB (#3):** quoted 0.026090 at send, received **0.025957 (−0.51% vs quote)**, still above the 1% minimum. In shares: 0.025977 shares → **230.97 USDT per share**. A one-hop route (`Elfomofi:NVDAB`) still under-delivered by half a percent.
- **NVDAon (#5):** quoted 0.026090, received **0.026093 (+0.01% vs quote)**. In shares: 0.026137 shares → **229.56 USDT per share**, **−0.12%** vs the 229.84 reference.
- **Same stock, one minute apart: Ondo was 0.61% cheaper per share than bStock** (229.56 vs 230.97). This happened even though Ondo's route was 4 hops and bStock's was one. The cheapest issuer isn't predictable from hop count or from which issuer has more volume. It has to be quoted live, which is exactly Tally's consolidated quote.

### F7. Every NVDA price we've measured in shares (2026-10-01)

| UTC | Source | Token | Route | USDT per share | Reference* | Premium |
|---|---|---|---|---|---|---|
| 12:33 | fork | NVDAB | `Metric:NVDAB` | 230.42 | 230.22 | +0.09% |
| 12:45 | fork | NVDAB | `Elfomofi:SKHYB > Pancakeswap V4:NVDAB` | 230.38 | 230.40 | −0.01% |
| 13:19 | fork | NVDAon | `Lista V3:USDC > Uniswap V4:NVDAB > Uniswap V4:NVDAon` | 229.90 | 230.16 | −0.11% |
| 13:45 | fork | NVDAB | `Biswap V2:BTCB > Topaz Cl:BSC_ETH > Genius:USDC > Uniswap V4:NVDAB` | 231.73 | 230.55 | +0.51% |
| 13:46 | fork | NVDAon | `Metric:NVDAon` | 230.69 | 230.55 | +0.06% |
| 14:21 | fork | NVDAB | `Elfomofi:NVDAB` | 230.03 | ~229.84 | ~+0.08% |
| 14:22 | fork | NVDAon | `Kipseli:NVDAB > Uniswap V4:NVDAon` | 229.72 | 229.84 | −0.05% |
| **14:23** | **live** | NVDAB | `Elfomofi:NVDAB` | **230.97** | ~229.84 | **~+0.49%** |
| **14:24** | **live** | NVDAon | `Uniswap V4:BTCB > Genius:USDC > Uniswap V4:NVDAB > Uniswap V4:NVDAon` | **229.56** | 229.84 | **−0.12%** |

\*Reference = `stockInfo.price` from the public RWA endpoint, read within ~1 minute (pre-market before 13:30 UTC). bStock returns `null`, so its reference is the Ondo token's value. The fork replay at 14:21 priced NVDAB at 230.03, and the live fill two minutes later got 230.97 on the same one-hop route. **Simulated prices are not guaranteed fills.**

### F8. Decisions made because of these findings
1. **Build Tally (not Stipend) as the entry.** Every risk we could test on Tally has been retired: region, contract holding, real routes, both issuers, live money.
2. **ShareGuard design: the contract is the trader** (test B passed for both issuers). The EIP-7702 batch (D/E) stays as the path for wallets that support batching, such as Agentic Wallet, if it does.
3. **Gas: always estimate, never trust the API's `gas`.** Simulate at the exact limit you send. Show users the real fee, not `tradeFee`.
4. **Re-quote immediately before signing.** Quotes go stale, and prices moved 0.4% in two minutes (§F7).
5. **Minimum order: 6 USDT** (Ondo's $5 is checked in USD).
6. **Backend in AWS Seoul**, with an IP-country gate for end users and RPC failover.
7. **xStocks: data and trap demo only.** Execution is bStock and Ondo.
8. **The pitch is "correct and cheapest-right-now".** Units and traps are always on; the per-order saving vs the other issuer is shown when there is one (0.61% measured live).

### F9. Still open
- **Larger sizes.** ~~Price impact at $100 and $1,000 is unknown.~~ Answered for quotes in §F10 (impact < 0.003%); real fills at those sizes are untested.
- **Ondo RFQ mode.** It's documented but never observed. Keep a code path and a test for it.
- **Ondo multiplier on-chain.** There isn't one. ShareGuard v1 uses a signed feed bounded per asset (§F11); the TS signer service is M3.
- **Whether Binance Wallet / Agentic Wallet can send EIP-7702 batches.**
- **Region behaviour for UK, Canada, Japan and the Netherlands.** Partly answered in §F10: NL blocked, JP allowed, CA inconclusive (clock skew), UK untested. Romania is blocked too.
- **The Binance Transaction API (simulation/broadcast).** Paths now known (§F10) but not exercised; `spike/record_m1_probes.py` records them. We still use `eth_call` / `eth_estimateGas`.
- ~~**The spike contract has a known arbitrary-call hole.**~~ Fixed in ShareGuard v1 (§F11): routers and approve targets are allow-listed, fork test G proves the attack reverts. The spike contract is still never to be deployed.
- **ShareGuard v1 is unaudited.** The spike's hardening list (reentrancy guard, pause check, Ondo feed) is done and tested (§F11), but nobody independent has reviewed it; mainnet use stays at test amounts.

**M0 wallet-provider checks (blueprint §8.1), status as of 2026-10-01**

| Check | Status |
|---|---|
| 3. Provider terms and AUP | **Done (desk review).** Privy AUP (updated 2025-12-16) restricts Cuba, Iran, North Korea, Syria, Crimea, Donetsk, Luhansk and restricted-party lists; no explicit securities ban; non-custodial use is outside its custodian clause. Details in blueprint §9. |
| 1. Native BSC embedded wallet + real tx | **Passed 2026-10-01 (email sign-in, laptop, `localhost:3000`).** Privy embedded wallet `0x0809…a4d9d1` sent a 0-value self-transfer on chain 56: [tx](https://bscscan.com/tx/0x04a5f53651c17d5f6572bcc5fbe56210aba8b02c4c985866b327c052453e13e8). Checked via BSC RPC: chainId `0x38`, from = to, value 0, status 1, gas 21,000 at 0.05 gwei. No bridging or other-chain default. |
| 2. External wallet connects and signs on BSC | **Passed 2026-10-01/02.** An external EOA (laptop, `localhost:3000`): 0-value self-transfer [tx](https://bscscan.com/tx/0x6af34fdaac73674112a366ff433100da7fc7690a5418b834819be8ae077e9ac1), chainId `0x38`, status 1, 21,000 gas. **Binance Web3 Wallet then connected and worked as well (user-reported, 2026-10-02; no tx hash recorded).** Findings: (a) after a reload the page can show a stale wallet while signed out (UI must key off `authenticated`); (b) after the user switched the wallet to X Layer while the page was open, the *Switch to BSC* button never appeared, so the page does not detect a live chain change. M3 must read `eth_chainId` from the provider at send time and call `switchChain(56)` before signing. |
| 4. Allowed origins | **Done** for `localhost:3000` and the laptop quick tunnel. The final domain must be added when it exists. |
| Cloudflare sub-region headers | **Still unverified.** Quick tunnels have no dashboard, so `cf-region-code` can only be confirmed once the domain is on Cloudflare with a named tunnel. Until then the gate blocks by country only. |
| Privy SDK/login blocked in any country? | Untested. |
| Region gate through a tunnel | **Passed.** Block page (HTTP 451) from a US phone, site loads from NG. Found and fixed a rewrite bug behind the tunnel (`EPROTO`). VPN on the same machine as `cloudflared` caused Cloudflare 524 timeouts, an artefact of the test setup, not the app (600-request stress test clean). KR exit not tested directly. |

### F10. M1 engine: what the Seoul recordings and the build showed (2026-10-02)
Evidence: `packages/binance/fixtures/raw/` (recorded on the Seoul EC2 and from VPN exits, 2026-10-02), `packages/*/src/*.test.ts`. Quotes are quotes, not fills (V11).

**Region (the 40304 body, from `region_block_*.json`, one valid-key `supported/chain` call per exit)**

| Exit | Result | Notes |
|---|---|---|
| US | `40304`, HTTP 200 | `"Service not available due to compliance restriction"` |
| NL | `40304`, HTTP 200 | Same body |
| **RO (Romania)** | **`40304`, HTTP 200** | **Not on the hackathon list.** Binance blocks it anyway |
| JP | **allowed** | Japan is on the hackathon list, so only our own edge gate stops it |
| CA | inconclusive: `40103` timestamp outside recv window | Likely clock skew on the test machine; rerun with a synced clock |

- A request with no key gets `40101` **before** any region check, so a block can only be recorded with a valid key from a blocked IP.
- **The docs list `40301`, `40302` (VPN detected) and `40303` but never `40304`**, the code callers actually get. The client treats 40301–40304 as one region-block kind.
- **Consequence for agents:** `baw` calls come from the user's own machine, so a user in Romania (or any other Binance-blocked place not on our list) is refused by Binance directly. Tally's web path is unaffected because the Seoul server makes the calls.

**Rate limit (`rate_limit_probe_*.json`)**
- 30 back-to-back `supported/chain` calls from Seoul: the first ~5 passed within ~50 ms, then every call returned **HTTP 429, `code 42900 "Rate limit exceeded"`**. Per-IP, per-key and per-endpoint limits are all documented as possible, which one this was is unknown.
- The client paces at a burst of 3, then 4 requests/s, and retries 42900 twice with backoff. Elevated limits were requested from the organisers; the design assumes the default.

**The authenticated RWA list is not a registry**
- `GET /api/v1/dex/market/rwa/tokens?chainId=56` returned **488 tokens (442 Ondo, 46 bStock, 0 xStocks)** against 675 on BSC in the public lists (458 + 87 + 130). Paging parameters are not documented; `spike/record_m1_probes.py` probes them.
- It does carry what the public lists don't: `statusInfo` (reason codes seen: `TRADING`, `MARKET_PAUSED` "Paused for session transition", `UNSUPPORTED`), `tokenToShareRatio`, and a reference price. bStock's `marketStatus` is `null` there too.
- The registry is therefore built from the public lists; status, reference price and listed price come from the authenticated list.

**`referencePrice` is per token, not per share (a correction to the first M1 build)**
- Ondo NFLX: `tokenPrice` 6808.01, `referencePrice` 680.80, `tokenToShareRatio` 10, while the quote API prices the same token at 680.80. Per share that is **$68.08**, and bStock NFLX trades at **$68.15**.
- NVDA, `referencePrice ÷ tokenToShareRatio`: Ondo row 231.66, bStock row 231.63, so the two issuers agree to 0.01% only after dividing. Using `referencePrice` directly misprices Ondo NFLX by 10×.
- **Binance's own list disagrees with its own quote API:** NFLXon `tokenPrice` (6808) is ten times the price the quote returns (680.80). This is more evidence for Trap Shield and the DX report.

**Quote ladder: $6 to $1,000, bStock vs Ondo (all 24 recorded quotes, all `SWAP`, all `estimateGasFee` 450000)**

| Ticker | USD | Best | Premium vs US (Ondo / bStock) | Price impact (max) | Saving vs runner-up |
|---|---|---|---|---|---|
| NVDA | 6 | Ondo | −0.06% / −0.02% | 0.0012% | 0.04% |
| NVDA | 25 | Ondo | −0.06% / +0.02% | 0.0001% | 0.05% |
| NVDA | 100 | Ondo | −0.06% / +0.02% | 0.0001% | 0.07% |
| NVDA | 1,000 | **bStock** | +0.06% / +0.03% | 0.0026% | 0.03% |
| AAPL | 6 | **bStock** | −0.08% / +0.05% | 0.0044% | 0.33% (Ondo took 4 legs) |
| AAPL | 25–1,000 | Ondo | +0.02% / +0.04% to +0.06% | ≤ 0.0009% | 0.02–0.04% |
| NFLX | 6–1,000 | bStock | Ondo blocked as a ghost ($16 of on-chain volume) / +0.06% to +0.11% | ≤ 0.0026% | – |

- **Price impact is negligible up to $1,000** in every recorded quote, which answers the open "larger sizes" question for *quotes*. Fills can still land below a quote (F6: −0.51% once).
- The cheapest issuer changes with size (NVDA flips to bStock at $1,000), and fees decide close calls: a 4-leg route cost ≈$0.03 more gas than a 1-leg one in the model, which is why AAPL at $6 prefers bStock.
- The gas model is deliberately conservative for 4 legs (1.03M assumed vs 775,639 used in F6); refine it with every real fill.

**Ghost markets are real and common for Ondo too:** NFLXon had **$16** of 24h on-chain volume (09-30 snapshot), NVDAon $78k, NVDAB $16.7M, NVDAx $52. The ≤$1,000 rule blocks NFLXon, so for some tickers only one issuer is executable.

**On-chain reads work from the cloud:** `uiMultiplier()` for NVDAB returned 1.000778223752807865 (identical to the API), and `multiplier()` for NVDAx 1.001701196801074 (matches the 09-30 snapshot, not the API's 1.000918).

**MEV protection:** `enableMevProtection` (optional boolean) exists only on `POST /api/v1/dex/pre-transaction/broadcast-transaction`. Tally has users sign and broadcast in their own wallet, so we cannot set it. Not claimed as a feature (blueprint §15).

**Endpoint paths from `web3.binance.com/en/dev-docs/llms-full.txt`** (from a summary of the page, so parameter names are unverified until `record_m1_probes.py` runs): Market `/api/v1/dex/market/{price,candlestick}`; Transaction `/api/v1/dex/pre-transaction/{supported/chain,gas-price,block-height,gas-limit,simulate,broadcast-transaction}` and `/post-transaction/orders`; Wallet `/api/v1/dex/balance/{supported/chain,all-token-balances-by-address,token-balances-by-address}`; `/api/v1/dex/aggregator/quote-and-swap` also exists. The docs name some quote parameters `chainId`/`fromToken`; the working calls use `binanceChainId`/`fromTokenAddress`.

**Probes recorded on the Seoul EC2 (`probes_20261002T052602Z.json`)**

| Endpoint | Result |
|---|---|
| `GET /market/rwa/tokens` paging | **Every paging parameter is ignored** (`pageSize`, `limit`, `page`, `pageNo`, `pageIndex`, `offset`, `tabId` all return the same 488). Only `platformId` filters (`bstock` → 46; `xstocks` → `40001 "Platform not found: xstocks"`). So the list is incomplete by design, and xStocks isn't in it at all. |
| `GET /market/rwa/underlying-profile` | Works. Ondo: `protections.dailyAttestationReport.url` (`…/daily-2026-09-29.pdf`) and a monthly report. **bStock: only `collateralReport` with a null URL**, so there is no dated report to age. |
| `GET /market/rwa/underlying-market` | Works. `marketData.referencePrice` is **per share** (231.49 for NVDA), `dividendYield` is a **percent** (`"0.12"`). It agrees with the list's `referencePrice ÷ tokenToShareRatio` within 0.1%, which confirms the per-token finding above. |
| `GET /market/rwa/price` | Needs `tokenContractAddresses` (plural). Not used yet. |
| `POST /pre-transaction/simulate` | **Works** with `{binanceChainId, evmTx:{from,to,data,value}}` → `{status:"SUCCESS", failReason, balanceChanges, allowanceChanges}`. The flat body fails with the misleading `50000 "evmParams is required for EVM chains"` (a client mistake reported as a server error). |
| `GET /pre-transaction/gas-price` | Works: `evmLegacyGasPrice.{low,medium,high}GasPrice` in wei (≈0.05 gwei). |
| `POST /pre-transaction/gas-limit` | `50000 "System error. Please try to sign the transaction again shortly."` for a read-only call. Not usable as recorded; we use `eth_estimateGas`. |
| `GET /market/price`, `/market/candlestick` | **Docs paths don't work as documented:** `price` answers `"Request method 'GET' not supported"` in a different error envelope (`code "000002"`, `status "ERROR"`), `candlestick` is a 404. |
| Wallet `balance/*` | `token-balances-by-address` works (returns the burner's `balance`, `rawBalance`, `tokenPrice`, `isRiskToken`); `all-token-balances-by-address` returned an empty `tokenAssets` for a wallet that holds tokens. `transactions-by-address` → `40001 "Parameter error"`. |
| `GET /aggregator/history` | Works and confirms the F6 NVDAB fill: `gasUsed` 437,968, `gasLimit` 698,076, `txType` "Swap". |

- **Error envelopes are inconsistent** across modules (`{code,msg,data,success}`, `{code,msg,data}` without `success`, and `{status,type,code,errorData}` for the Market gateway), and two real client mistakes were reported as `50000` server errors. Worth a line in the DX report.
- Attestation age is wired: Ondo NVDA's report (`daily-2026-09-29`) was 3.2 days old at 05:26 UTC on Friday 2026-10-02, so it carries the −10 deduction from §7.5. **That is not explained by a weekend** (it was a Friday), and one token at one moment is too little data to say how stale Ondo reports usually are. The rule stays as written (calendar days, > 3) until a few days of `tally facts` output from the EC2 show the real lag.
- **A live run 18 minutes later (05:44 UTC) showed no attestation deduction for the same token**, where the fixture engine showed −10. The cause is not proven: either a report was published in between, or the `underlying-profile` call failed. A failure would have been invisible, because the adapter's warning went to stderr (not captured by `> live.json`) and the quote's own `warnings` only held core's messages. Fixed: every integrity check now records its inputs and outcome, a missing fact carries the reason it is missing, and those reasons appear in the quote's `warnings`. `tally facts` and `tally quote --checks` print the log. A failed call is also retried with a longer backoff after a 42900 (1 s, 2 s).

**Live confirmation (exit check 1, live): `pnpm tally quote NVDA 25 --json` on the Seoul EC2, 2026-10-02 05:44 UTC** (`packages/engine/fixtures/live_quote_NVDA_25_20261002T054441Z.json`). Real Binance API and BSC RPC, no warnings, no row errors. Ondo won: 0.107897 shares at $231.59 (−0.05% vs the $231.71 US price), 2 legs via NVDAB, fee ≈$0.023; bStock 0.107807 shares at $231.79 (+0.03%), 1 leg, fee ≈$0.017. Ondo saved 0.059% ($0.015) vs bStock, fee included. xStocks: F, multiplier disagreement and $0 of on-chain volume. The fixture engine matches it on winner, executability, multiplier sources and grades, and on prices within 0.2% (`live-parity.test.ts`).

**Other build findings**
- Schemas written from the docs failed on real data twice (`assetType` is `null` on some rows; `executionMode` sits at the top level of the swap response, not inside `routerResult`). The first version swallowed the failure and silently fell back to stale public data, so every fallback now reports a warning.
- Ondo bounds use a stored baseline (`data/ondo-multiplier-baseline.json`, seeded from the 09-30 snapshot). Rule: one increase ≤ 3% is accepted (a judgement threshold, ≈5× the largest step seen) unless the independent price check fails; a decrease or an increase above 3% is accepted automatically only with (1) a `stock_split`/`stock_dividend` status seen within 48 h, (2) new/old within 0.5% of a simple ratio (n or 1/n for n in 2,3,4,5,8,10,15,20,25,30,50, plus 3/2 and 2/3), and (3) after trading resumes, tokenPrice ÷ newMultiplier within 2% of `stockInfo.price`; otherwise it stays blocked and flagged, with the owner's manual action only a fallback. The per-day yield cap was removed because distribution steps would trip it: between 09-30 and 10-02, **31 of 458 Ondo multipliers changed, each in one step, none decreased, max +0.58% (USHY)** (`research/ondo-multiplier-steps.md`), while a yield ÷ 365 cap allows about 0.016%/day for HYG, which stepped +0.40%. The earlier "PFE +1.5% in one day" figure was an estimate (≈6% yield ÷ 4), not observed. Check 3 on the real 09-30 public data: 28 Ondo tokens within 0.15% in a regular session (NFLXon 10×: +0.06%, CRWDon 4×: +0.01%); the xStocks NFLX token, whose multiplier of 10 disagrees with its price, fails at −89.8%. Still open: the Ondo RFQ path, moving the baseline to SQLite, and what `reasonMsg` looks like in a real corporate action (it is documented as a bare code; none has been recorded).

### F11. M2 ShareGuard v1: what the build and the fork tests showed (2026-10-02)
Evidence: `contracts/` (`src/ShareGuard.sol`, `test/*.t.sol`, `captures/`), run from the US cloud sandbox against an archive BSC RPC. **Status: all three M2 exit checks pass: (1) unit, fuzz and fork A–I; (2) deployed and verified on BscScan (verification reported by the owner); (3) two live guarded buys with `Guarded` events, checked against the chain (see "Live deployment and guarded buys" below).**

**Does bStock have a pause getter? No (blueprint §20 answered).** The NVDAB token is an EIP-1967 *beacon* proxy (beacon `0x156d…93a3`, implementation `0xCFEd…4e46`, 10,836 bytes). Its code contains the `isTokenPaused(address)` selector but not `tokenPauseManager()`, `paused()` or `isPaused()`, and calling any of those on the token reverts. A `debug_traceCall` (callTracer) of a `transfer` shows the token calling `isTokenPaused(token)` on a **shared manager, `0x9fc74Be63f3589485B2423984a7a0557e0CF700a`**, which returns `false`. The same manager answers for NVDAB, AAPLB, TSLAB, QQQB and SPYB. Ondo is the opposite: NVDAon (also a beacon proxy) exposes `tokenPauseManager()` → `0x6334…638F`, whose `isTokenPaused(NVDAon)` is `false`. xStocks NVDAx (implementation `0x65c4…f19b`) has `isPaused()` = `false`. So bStock's manager can only be found by tracing a call, and nothing on the token announces a rotation. ShareGuard therefore keeps the bStock manager in the asset's config and reads Ondo's from the token on every swap. `debug_traceCall` works on QuickNode and is how to find such hidden dependencies.

**The fork tests are now reproducible: an archive RPC pins them to the capture's block.** F5 found that 90-minute-old captures failed to replay on a fork of the chain tip. Forking at `blockAtCapture` (QuickNode archive) replays the 2026-10-01 14:21–14:22 UTC captures a day later, deterministically, with no Binance key: they are committed in `contracts/captures/`. `FORK_LATEST=1` restores the old mode for a capture made seconds ago.

| Test | NVDAB (`Elfomofi:NVDAB`, 1 hop) | NVDAon (`Kipseli:NVDAB > Uniswap V4:NVDAon`) |
|---|---|---|
| A replay as plain wallet | ✅ | ✅ |
| B guard as the trader (+ `Guarded` event, approval 0, guard holds nothing) | ✅ | ✅ |
| B2 same, with a signed EIP-712 feed update | skipped (not a Feed asset) | ✅ |
| C share shortfall reverts | ✅ | ✅ |
| D, E 7702 batch and atomic revert | ✅ ✅ | ✅ ✅ |
| F route fits **our** gas limit | ✅ | ✅ |
| G arbitrary-call attack reverts | ✅ | ✅ |
| H paused token reverts (mocked manager); manager that reverts fails closed | ✅ | ✅ |
| I stale or out-of-bounds feed reverts | skipped (not a Feed asset) | ✅ |

Offline: **72 unit and fuzz tests pass** (swap, admin, feed bounds, monotonic replay, staleness, corporate actions, signatures, ownership, rescue, reentrancy, 7702 batch; 6 fuzz properties at 512 runs: share maths over multipliers 1e15–1e20, exact minimum, refund and no residue, tolerance, the per-asset feed bound, only-allow-listed-routers-are-called). A Python-signed (`eth_account`) EIP-712 update verifies against the contract's own digest (`PythonFeedSignature.t.sol`), so `tools/guarded_buy.py` and the contract agree.

**Gas (test F; fork figures, approximate: a fork test is one transaction, so access warmth differs from live).** NVDAB: guarded call used 723,790; smallest limit that succeeds + intrinsic = 674,479; limit we would send (×1.25) = 843,099. NVDAon: used 1,384,434; estimate 1,458,555; limit 1,823,194. **The API's 450,000 is too low for both**, and the test says so. The authoritative figure is `eth_estimateGas` at the live buy, which the tool records next to the API's number.

**Correction to blueprint §10: the arbitrary-call attack needs one more trick.** Fork test G runs the spike's swap logic (`test/SpikeVulnerable.sol`, a test-only copy) against real USDT and the real stock. The attack exactly as the blueprint worded it (`tokenIn = USDT`, `router = USDT`, `data = transferFrom(victim, attacker, X)`) **reverts in the spike** on its own "no output" check, because the stock balance does not move. The working exploit sets **`tokenIn` = the stock** (the attacker pulls a dust amount of it, which the output check then counts as output) with `router = USDT`: that drains the victim's whole approved USDT balance in one call. The hole is real; the blueprint's one-line description was incomplete. ShareGuard v1 stops all variants three ways: the router must be allow-listed (`RouterNotAllowed`), `tokenIn == stock` reverts (`SameToken`), and a router or approve target can never be a configured stock token. G asserts the victim keeps every token. The allow-listed real router given the attack calldata also fails, because it is not a token contract.

**Deploy dry run (key-less, live BSC state, 10 tokens: NVDA, AAPL, TSLA, QQQ, SPY × bStock and Ondo):** every asset prices (`sharesPerToken` NVDAB 1.000778, NVDAon 1.001715, SPYon 1.009473) and answers its pause check; estimated 5.55M gas ≈ 0.00028 BNB at 0.05 gwei; contract runtime 14,597 bytes. `tools/gen_assets.py` refuses an Ondo seed when the public list's `multiplier` and the dynamic endpoint's `sharesMultiplier` differ by more than 0.1% (all five agreed exactly on 2026-10-02).

**Design decisions made in M2 (deviations or additions to §10, for review):**
1. **The first Ondo multiplier is owner-seeded** (`setAsset(..., seedMultiplier)`, only while the feed has never been seeded). The deploy script has only the deployer key and cannot produce a signed first value; every later change must be signed and bounded.
2. **Feed updates are monotonic by `validAfter`.** An older signed update reverts (`UpdateOlderThanStored`); the identical update may be resubmitted by another user's swap (it only refreshes the timestamp); the same `validAfter` with a different value reverts. `updatedAt` is the block time of acceptance, and `validUntil` must still be in the future.
3. **A swap also needs `minShares > 0`** (a zero minimum would switch the guard off for a naive caller) and `tokenIn != stock`.
4. **`maxStepBps` is capped at 1000 (10%)** so a configuration slip cannot open the bound; splits go through corporate actions anyway. `maxAge` is owner-settable within 1 hour – 7 days.
5. **`tokenIn` is not allow-listed.** The guard holds nothing between transactions, so an odd input token can only hurt the caller who chose it. Revisit if the audit disagrees.
6. **Pause checks fail closed:** a manager that reverts, returns the wrong size, or a token that reports no manager makes the swap revert (`PauseCheckFailed`) instead of passing.

**Live deployment and guarded buys (2026-10-02, owner-run; results in `contracts/results/`, deploy record in `contracts/broadcast/Deploy.s.sol/56/run-latest.json`).**
- **ShareGuard v1: [`0x28F6F19bffbF25E36452c78d12090F0bC922970a`](https://bscscan.com/address/0x28f6f19bffbf25e36452c78d12090F0bC922970a)**, block 125266385, deploy tx `0xbebce369…0d59`. 12 transactions (deploy, router, 10 assets) cost 0.00021 BNB in total (4.2M gas at 0.05 gwei), below the dry run's estimate. Read back from the chain: owner = the deployer wallet `0x327D…f710`, no pending owner, feed signer `0xDd3C…f407`, not paused, `maxAge` 3 days, router `0xB444…dDA5` allow-listed with itself as approve target, NVDAB and NVDAon price (1.000778 / 1.001715) and answer their pause checks. The on-chain runtime has the same length as a local build (14,597 bytes).
- **BscScan verification took two attempts.** The submission from `forge script --verify` was accepted (`OK`), then the Etherscan queue answered "Pending in queue" and finally "Other Exception - Please contact us". Resubmitting with `forge verify-contract … --watch` succeeded (reported by the owner). Sourcify received the contract too.

| | NVDAB (bStock) | NVDAon (Ondo, signed feed) |
|---|---|---|
| Swap tx | [`0xb678802d…9a8e`](https://bscscan.com/tx/0xb678802dfb1dfa6e1206ac01fdf79d18181d5d61bab23d307b7ea059abc39a8e), block 125272679 | [`0x55ec2447…e11a`](https://bscscan.com/tx/0x55ec244764dae2778357a7a446f5ec95de03cf2243fbff3ea1f3b4458a22e11a), block 125273150 |
| Route at send | `Topaz Cl:NVDAB` (1 hop) | `Metric:NVDAB > Uniswap V4:NVDAon` (2 hops, via bStock again) |
| Spent / received | 6 USDT → 0.025654736 tokens | 6 USDT → 0.025660879 tokens |
| **Shares (event)** | **0.025674701** (min 0.025417827, 1% tolerance) | **0.025704894** (min 0.025447870) |
| USDT per share | 233.693 | 233.419 |
| vs US reference 233.9354\* | −0.10% | −0.22% |
| Gas: estimate → limit sent → used; API said | 554,149 → 692,687 → **440,520**; 450,000 | 814,600 → 1,018,250 → **648,385**; 450,000 |
| Gas cost | 0.0000220 BNB | 0.0000324 BNB |

\*bStock's own `stockInfo.price` is `null` (V15), so the NVDAB row borrows the reference the NVDAon run read from the same endpoint a minute apart.

- **Verified on the chain, not just in the tool's output:** both receipts have `status 1`, `to` = the guard, and exactly one `Guarded` event from the guard whose tokens, shares and multiplier match the result files. Afterwards the guard holds 0 USDT, 0 NVDAB and 0 NVDAon, and the burner's USDT allowance to it is 0 (exact approval, reset by the guard).
- **The signed feed path ran live.** The NVDAon buy sent `swapForSharesWithFeed` with an update signed by `0xDd3C…f407` (multiplier 1.0017152488, equal to the stored value, so it refreshed the timestamp): the contract accepted the Python-made EIP-712 signature, and `feedOf` now shows `updatedAt` 1790935427 and `validAfter` 1790935379. The decrease and out-of-bounds paths are fork-tested only (test I), not exercised on mainnet.
- **The API's 450,000 gas is wrong again.** NVDAon used 648,385, so sending the API's value would have reverted out of gas, as in F6. NVDAB used 440,520, just under 450,000, which only fits by luck. `eth_estimateGas` overshot actual usage by 25.8% and 25.6% (F6: 21–27%), so the ×1.25 limit held with a thin margin on the estimate side. The fork test's NVDAon estimate (1.46M) was about 80% above the live one because the live route differed (`Metric:NVDAB > Uniswap V4`, not the captured `Kipseli` route): fork gas figures are direction only.
- **Cross-issuer:** same minute-scale pattern as F6 (Ondo cheaper per share than bStock: 233.419 vs 233.693, 0.12%), here with a route through the other issuer.

**Operational findings while deploying (for the DX report's "tooling" notes, none caused by Binance):** the owner's terminal passed `# comment` text after a command as arguments, which broke `gen_assets.py` (it took `#`, `seeds`, `expire` for tickers and silently dropped `SPY`) and `forge script` (`encode length mismatch: expected 0 types, got 1`); the clone had a stale `lib/forge-std` gitlink so submodules failed; and a pasted command wrapped onto two lines. The tool now rejects non-tickers and unknown tickers, and the README has no trailing comments. A fresh Python venv was needed on the EC2 (`eth-account`).

**Not done / still open after M2:** an independent review of the contract (still unaudited; amounts stay at test size); the TS feed-signer service and the engine's use of `Guarded` receipts (M3); whether the bStock pause manager can change without notice; the corporate-action and stale-feed paths have not been exercised on mainnet.

## The DX report (25%): write it yourself, as you go
The rules reject AI-generated reports, so **keep a timestamped human log from the first minute**. That covers time to first successful call, each error message copied verbatim, and page URL plus section for every doc problem. The items below are leads we found from outside with public endpoints. **Confirm each one yourself with your key before it goes in the report:**
- Three different multiplier values for the same token across list API, dynamic API and on-chain (xStocks).
- `liquidity` = 0 on tokens with thousands of router transfers per hour.
- `marketStatus` returned only for Ondo tokens.
- `tokenInfo.volume24h` is the **US stock** volume, not on-chain volume. The skill docs admit this, but the field name misleads.
- RWA Data API docs list `platformId: "ondo" | "bstock"` only, while xStocks are `type=2` in the public list.
- The tokenized-securities skill says Ondo is "the only supported provider", which contradicts the agentic-wallet skill.
- The `referencePrice` definition (see §2 warning).
- xStocks on BSC: stale prices with ~$0 volume that are still returned as tradable (`TRADING`).
- *Seen with your key on 2026-10-01:* the region block `40304` comes back as **HTTP 200**, so clients checking only the status code treat it as success. It also blocks unrelated calls like `supported/chain`.
- *Seen with your key:* the Trading API reference documents no region, compliance or KYC error codes at all.
- *Seen with your key:* Ondo is documented as RFQ (EIP-712 + `order/submit`), but pre-market quotes returned `SWAP` with `rfq: null`, while still demanding `userWalletAddress` "for RFQ (Ondo)".
- *Seen with your key:* the field name `tradeFee` doesn't say it's the network fee in USD (it matches gas × gas price).
- *Seen with your key:* stock quotes return a single route from a single vendor, so the "aggregator" gives no comparison for these tokens.
- *Seen with your key:* Ondo's minimum is "5 USD" (`40375`, again HTTP 200), but the quote is in USDT. 5 USDT is rejected because USDT trades slightly under $1, and the docs don't mention the minimum.
- *Seen with your key:* an NVDAB route went through SKHYB (SK Hynix bStock). Route transparency isn't exposed beyond `dexRouterList`.
- *Seen with your key:* `tx.gas` / `estimateGasFee` is always `450000`, whatever the route. A 4-hop swap needed ~1,024,000 and reverted out of gas on mainnet when sent with the API's value (tx `0xfd7799e7…a40c`). This is the most costly pitfall so far, because users pay gas for the revert.
- *Seen live:* a one-hop NVDAB fill delivered 0.51% less than the quote made seconds earlier (still inside the 1% minimum). Worth asking how long a quote is valid and what `priceImpactPercent: 0` actually means.
- *Seen live:* swap #5 used 775,639 gas against the API's 450,000; `eth_estimateGas` overshot actual usage by ~21–27%.
- *Seen during the run:* the public BSC RPC `bsc-rpc.publicnode.com` started answering HTTP 403 to the AWS box mid-session. Not Binance's API, but worth a line on "which RPC to use with the Trading API".

## Reproduce
```bash
python3 research/analyze_winners.py                        # hackathon-winner patterns
python3 research/fetch_snapshot.py                         # fresh public-API + on-chain snapshot
python3 research/analyze_snapshot.py research/snapshot-<date>
python3 research/region_check.py --label <where>           # needs your API key; read-only
cd spike && ./setup.sh && ./run_fork_spike.sh              # ShareGuard on a BSC fork; see spike/README.md
```
Numbers in this document come from `research/snapshot-2026-09-30/` (fetched 19:35 UTC, US regular session).
