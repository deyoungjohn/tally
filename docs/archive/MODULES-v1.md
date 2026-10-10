# Tally modules: Receipts, Switch and Rewards → Stocks

Three proposed extensions to Tally, with a verdict, an architecture and a viability gate for each.

| | |
|---|---|
| Written | 2026-10-02, after M2 (ShareGuard v1 deployed at `0x28F6F19bffbF25E36452c78d12090F0bC922970a`) and during M3 |
| Inputs | `Composable_Modules.md` (Compound Yield, Migrate Shares) and `LotLens_Module_Concept.md` (Trace), supplied by the user |
| Rule | **No module may regress the existing buy flow, Portfolio or Radar.** See §8. |
| Status | Proposal. Modules ship only after their viability gate (§6) passes. |

---

## 1. Verdicts

| Module | Source name | Tally name (UI) | Verdict | Priority | Why |
|---|---|---|---|---|---|
| **A. Receipts** | Trace | **Receipt** ("Reconciled") | **Build now** | P0 | Tally already has most of it (share math, ShareGuard events, Ondo baseline, working Transaction API `simulate`). It turns every trade into verifiable evidence, which 57% of past winners were built on. ~1–1.5 days. |
| **B. Switch** (incl. **Sell**) | Migrate Shares | **Switch issuer** and **Sell** | **Build after gate V-B** | P1 | The deployed ShareGuard **already accepts a stock as the input token** (no USDT-only check), so a one-route switch may need **no new contract**. Sell is missing from Tally anyway. ~1.5–2 days. |
| **C. Rewards → Stocks** | Compound Yield | **Rewards → Stocks** | **Manual version only if gate V-C passes; automation after the hackathon** | P2 | Real rewards must reach the **$5 minimum order**, which needs capital and time. Automation needs delegated authority (session keys/7702), which is beyond scope before 11 Oct. |

Product story (one line for the pitch): **Buy at the true best price → Hold in shares → Prove every fill → Switch issuers safely → Grow from rewards.**

---

## 2. Where they live in the UI (no new top-level pages)
Navigation stays **Tally · Trade · Portfolio · Radar** (+ Docs).

| Module | Surface |
|---|---|
| Receipts | Every trade's result screen becomes a Receipt. **Portfolio → Activity** tab lists all receipts. `/receipt/[txHash]` is a shareable deep link. |
| Sell | **Portfolio → holding row → Sell** (and a Buy/Sell toggle on the Trade card). |
| Switch | **Portfolio → holding row → Switch issuer**. Also a contextual prompt on Radar when a held token's grade drops (e.g. paused, ghost). Facts only, never "you should". |
| Rewards → Stocks | **Portfolio → "DeFi rewards" card**, shown only when the connected wallet has a supported position with claimable rewards. |

---

## 3. Shared foundations (built once, used by all three)

### 3.1 Trade intents
One typed object describes any guarded operation, so all modules share the same plan → simulate → sign → reconcile pipeline (blueprint §7.6):

```ts
type TradeIntent =
  | { kind: "buy";    tokenIn: "USDT"; amountIn: bigint; stock: Address; minShares: bigint }
  | { kind: "sell";   stock: Address; amountIn: bigint; minUsdtOut: bigint }
  | { kind: "switch"; from: Address; amountIn: bigint; to: Address; minSharesOut: bigint }
  | { kind: "rewardsToStock"; claim: ClaimSpec; stock: Address; minShares: bigint };
```

### 3.2 Contract usage
- **Buy and Switch** use the **deployed** `ShareGuard.swapForShares` / `swapForSharesWithFeed` unchanged:
  - Switch passes `tokenIn = source stock`, `stock = destination stock`, and route calldata built for the guard.
  - The contract measures the destination in **shares** and refunds unspent input.
  - `SameToken`, router allow-list and pause checks already apply.
- **Sell** needs a **minimum-USDT** check, which v1 doesn't have (it only checks shares of an enabled stock).
  - **Preferred:** no contract change. The user's wallet sends the API's swap transaction directly; the router's own `minReceiveAmount` enforces the floor; and Receipts reconciles the result.
  - **If an onchain guard is wanted later:** add `ShareGuard v1.1` with `swapForMinOut(tokenIn, amountIn, tokenOut, minOut, …)` as a **separate deployment**. v1 stays untouched for buys.
- **Rewards → Stocks:** the claim is the DeFi API's own transaction, signed by the user; the buy goes through the deployed ShareGuard. No new contract in the manual version.

### 3.3 Evidence store
SQLite (blueprint §14), tables `intents`, `quotes`, `simulations`, `transactions`, `observations` (multiplier and price readings with IDs), `receipts`. The Ondo baseline (`data/ondo-multiplier-baseline.json`) moves here as `observations`.

---

## 4. Module A: Receipts (Trace)

**Job:** answer *"Did I receive what Tally said I'd receive?"* for every guarded operation, with evidence.

**Captured at each step of the trade plan** (blueprint §7.6), in `packages/receipts`:

| Stage | What's stored | Source |
|---|---|---|
| Intent | asset address + issuer, spend token and amount, min shares/out, tolerance, approvedAt | the confirm sheet |
| Quote | quoteId, expected out, route text, observedAt, expiresAt | Trading API |
| Simulation | predicted balance changes, gas limit sent | **Transaction API `POST /pre-transaction/simulate`** (works, F10) + `eth_call` at the exact limit |
| Conversion | multiplier value, source (onchain `uiMultiplier` / feed / API), observationId, observedAt | engine |
| Realized | txHash, block, status, **ShareGuard `Guarded` event** (tokensOut, shares, multiplier used onchain), ERC-20 `Transfer` logs **from this tx only** | BSC receipt |

**Reconciliation** is deterministic, never AI-generated:

| Status | When |
|---|---|
| `RECONCILED` | realized within 0.01% of simulation, same asset |
| `RECONCILED_WITH_DIFFERENCE` | realized ≠ simulation, but ≥ the signed minimum; show the difference without guessing a cause |
| `PENDING` | no receipt yet (keep the hash; RPC failover) |
| `FAILED` | reverted (decode `InsufficientShares`, `TokenPaused`, `FailedInnerCall`, …) |
| `UNRECONCILED` | wrong asset received, or no transfer evidence explains the amount |

**Rules:**
- **Raw token units are authoritative.** Shares are derived and shown with *"ratio 1.000778, observed 14:23:11 UTC, onchain"*.
- **A receipt never changes when the multiplier changes later**, because it stores its observationId.
- The onchain `Guarded` event is the primary realized evidence; Transfer logs cross-check it.

**UI** (DESIGN.md glass card): a stage ladder **Quoted → Simulated → Received**, a "Why different?" disclosure, the conversion provenance line, and an evidence drawer (tx, block, observation IDs). Badge: **✓ Reconciled** (or amber "Reconciled, 0.51% below quote").

**Agents:** MCP tool `get_receipt(txHash)` returns the structured result. The Wallet Skill reports *"confirmed and reconciled: received 0.025957 NVDAB = 0.025977 shares, 0.51% below quote, above your minimum"* instead of "done".

**Real test vectors already on record** (F6):
- the NVDAB live buy (realized −0.51% vs quote → `RECONCILED_WITH_DIFFERENCE`);
- the NVDAon live buy (+0.01% → `RECONCILED`);
- the out-of-gas NVDAon revert (→ `FAILED`, `FailedInnerCall`).

**Required edge tests** (from Trace): wrong decimals, a later multiplier change (receipt must not move), and missing transfer evidence (→ `UNRECONCILED`).

**Not in scope:** tax/accounting, dividend tracking, legal analysis, an onchain receipt registry.

---

## 5. Module B: Sell and Switch issuer (Migrate Shares)

### 5.1 Sell
**Flow:** Portfolio row → Sell → amount in shares or $ → quote stock → USDT (with `userWalletAddress = user`) → simulate → user signs the API transaction directly → Receipt.

**Guards:**
- the router's `minReceiveAmount` from the user's tolerance;
- Receipts checks realized USDT ≥ min.

**Limits:**
- the minimum order ($5, so 6 USDT-equivalent);
- Ondo trading status (pre-market, regular, closed);
- the RFQ path stays P2.

### 5.2 Switch issuer
**What the user sees** (Portfolio → Switch issuer):
```
From   NVDA via Ondo     0.026093 tokens = 0.026137 shares
To     NVDA via bStock   ≈ 0.026110 shares  (cost ≈ 0.10%, fee ≈ $0.03)
At least 0.025849 shares or nothing happens.   ✓ Assured
```

**Execution, in order of preference:**
1. **One route, one transaction (preferred).** Quote `from = source stock, to = destination stock`, with the route built for **ShareGuard**. We already know a Uniswap v4 NVDAB/NVDAon pool exists (F4). Call the deployed `swapForShares(tokenIn = source, stock = destination, minShares = destination share floor, …)`. It's atomic: either both sides happen or neither, and the floor is in **shares**, stronger than the token floor the source idea proposed.
2. **Two legs** (source → USDT → destination) only if no direct route exists. A single atomic transaction then needs a contract that runs both legs (`ShareGuard v1.1 switch()`, separate deployment) or an EIP-7702 batch. **If neither is available, don't ship Switch** rather than present two separate transactions as atomic (the source idea's own rule).

**Product rules:**
- Show the facts: shares in, shares out, cost %, fee, each issuer's integrity grade and reasons.
- **No automatic "switch now" recommendations.** The user decides, and the copy states that the two issuers' tokens are different products.
- **xStocks as a source:** the BSC market has about $0 volume (F1), so Switch will usually fail to quote. Say so plainly ("No market to exit this token on BNB Chain") instead of failing silently.

**Feed assets:** switching *into* Ondo uses `swapForSharesWithFeed` with a fresh signed multiplier (M3's signer service).

---

## 6. Module C: Rewards → Stocks (Compound Yield), manual version

**Job:** turn **realized** DeFi rewards into a stock, never principal.

**What Binance's DeFi tooling gives us** (Agentic Wallet `defi.md`):
- positions expose `tokenList.reward[]` (claimable);
- claims are typed: `REWARD_PROTOCOL`, `REWARD_INVESTMENT`, `LP_FEE`, `REDEMPTION`;
- `defi preview` returns balance changes before signing.

**Flow** (two signatures, no automation, no custody):
1. **Read:** DeFi Data shows the supported position and its claimable rewards (only one allow-listed protocol and investment ID in v1).
2. **Claim:** DeFi Transaction builds the claim.
   - **Allowed claim types:** `REWARD_PROTOCOL`, `REWARD_INVESTMENT`, `LP_FEE`. **`REDEMPTION` is hard-blocked** (it returns principal).
   - Before signing, simulate (Transaction API) and require that the supply/position amounts are **unchanged** and only reward tokens increase. Otherwise refuse.
3. **Buy:** the budget is the **reward amount received in the claim transaction's own Transfer logs** (Receipts decoding), never the wallet balance. Then a normal guarded buy of the chosen stock with that budget.
4. **Receipt** links both transactions: "Claimed 12.4 CAKE → bought 0.0261 NVDA shares; position unchanged at 100 units".

**Economic filter:** show *fee ÷ reward value*; disable "Convert" when that's above 2% or the reward is below the **$6 minimum**.

**Why it's P2:**
- **Money and time:** a demo needs about $6+ of *claimable* rewards. At 20% APR that's roughly $3,000 deposited for 4 days, or a high-fee LP position.
- **Unknowns:** the DeFi REST paths aren't verified yet (we've only seen the `baw` CLI). The reward token also needs a route to the stock (CAKE/XVS → USDT → stock should exist; to be verified).

**Automation** (rewards → stocks on a schedule) needs delegated, limited authority (session keys or 7702 with a policy contract), plus a keeper and an isolated receiver. That's post-hackathon. Do not ship a simulated or fake "auto-harvest".

---

## 7. Viability gates (run before building each module)

| Gate | Module | How | Pass if |
|---|---|---|---|
| **V-A** | Receipts | Reconcile the three recorded live transactions (F6) offline from their BscScan receipts + stored quotes | Statuses come out `RECONCILED_WITH_DIFFERENCE`, `RECONCILED`, `FAILED` with correct numbers; the three edge tests pass |
| **V-B1** | Switch | On the Seoul EC2: `cd ~/tally/spike && python3 ../research/module_viability.py --guard 0x28F6F19bffbF25E36452c78d12090F0bC922970a`, in pre-market **and** regular hours | Direct stock → stock quotes return `SWAP` for NVDA and AAPL in both directions, cost < 0.5% at $7 |
| **V-B2** | Sell | Same script (sell rows) | Stock → USDT returns `SWAP` for bStock and Ondo; USDT per share within 0.3% of the reference |
| **V-B3** | Switch | Fork test (new test J): impersonate a real NVDAB holder, replay the captured switch calldata through the **deployed** ShareGuard bytecode | Shares measured in NVDAon ≥ floor; source fully spent or refunded; test K (floor too high) reverts atomically |
| **V-B4** | Switch, Sell | One live $6 switch and one live $6 sell from the burner | Both reconcile in Receipts |
| **V-C1** | Rewards | `baw defi position` on the team's agent wallet; `baw defi investment-list --investType Earn --binanceChainId 56` | A BSC position with non-empty `tokenList.reward[]` is reachable; the claim type is a REWARD_* or LP_FEE |
| **V-C2** | Rewards | `baw defi preview --action CLAIM …`, then the Transaction API simulate | The supply amount is unchanged, only the reward balance rises |
| **V-C3** | Rewards | Trading API quote reward token → stock | A route exists at ≥ $6 |

If V-B1 fails (no direct route), Switch drops to "Sell then Buy" **shown honestly as two steps**, or is cut. If any V-C gate fails, Rewards → Stocks is cut and documented as future work.

---

## 8. No-regression guardrails
1. **Additive only.** No change to the deployed ShareGuard or to the existing buy path. New contracts, if any, are separate deployments (`v1.1`).
2. **Feature flags** (`FEATURE_RECEIPTS`, `FEATURE_SELL`, `FEATURE_SWITCH`, `FEATURE_REWARDS`) in `packages/config`, default off. Each turns on only after its gate passes.
3. **Every existing test stays green** (unit, fuzz, fork A–I, Playwright at 375/768/1280) before and after each module. New fork tests J and K for Switch.
4. **Same pipeline:** every module goes through plan → simulate at the exact gas limit → sign → reconcile. No module gets its own shortcut.
5. **Same region gate and minimums** (6 USDT, Ondo RFQ handling) apply to Sell, Switch and Rewards.

---

## 9. Schedule against the 11 Oct 12:00 UTC lock

| When | Work |
|---|---|
| Fri 2 – Sat 3 Oct | Finish M3. **Receipts (A)** built into the trade flow (it reuses M3's plan/simulate code). Run gate V-B1/V-B2 on the EC2. |
| Sun 4 – Mon 5 Oct | **Sell + Switch (B)** if V-B passes. Fork tests J/K, then live $6 switch and sell. |
| Tue 6 – Wed 7 Oct | M5 agent layer (Skill + MCP, now including `get_receipt` and switch/sell intents). Upstream PR. |
| Thu 8 Oct | Rewards → Stocks (C) **only if** V-C passed and real rewards ≥ $6 exist; otherwise Telegram v1 or polish. |
| Fri 9 – Sat 10 Oct | Polish, README, demo video. Code freeze Sat 23:59 UTC. |
| Sun 11 Oct | Submit before 12:00 UTC. |

**Demo additions:** the receipt ladder (Quoted → Simulated → Received) on the live NVDAB buy that came in 0.51% under quote; then a Switch from Ondo to bStock with its floor shown in shares, plus a deliberately failing switch (floor too high) that reverts and leaves the user's tokens untouched.
