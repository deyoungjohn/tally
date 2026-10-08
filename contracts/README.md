# ShareGuard v1 (`contracts/`)

Foundry project. Spec: `TALLY_BLUEPRINT.md` §10. Evidence: `IDEAS.md` §F11.
Solidity 0.8.28, EVM `prague`, OpenZeppelin 5.4 and forge-std 1.10 as **git submodules**
(`git clone --recurse-submodules`, or `git submodule update --init --recursive`).

| Path | What |
|---|---|
| `src/ShareGuard.sol` | the contract (not upgradeable; ~14.6 KB) |
| `src/BatchExecutor.sol` | EIP-7702 delegate used only by tests D and E |
| `test/*.t.sol` | unit, fuzz, and fork tests A–I (`ShareGuardFork.t.sol`) |
| `test/SpikeVulnerable.sol` | **test-only** copy of the spike's hole, so test G can show it is real. Never deploy |
| `captures/` | real Trading API calldata (read by the fork tests) |
| `script/Deploy.s.sol` | deploy + configure + verify (run on **your** machine) |
| `deploy/assets.json` | stable: tokens to allow-list (`tools/gen_assets.py`) |
| `tools/gen_assets.py` | builds `deploy/assets.json` and the fresh Ondo seeds `deploy/seeds.json` |
| `tools/guarded_buy.py` | the live guarded buys (run on the Seoul EC2) |
| `script/fork.sh`, `script/capture.sh` | run fork tests / capture fresh calldata |

**Deployed:** BSC `0x28F6F19bffbF25E36452c78d12090F0bC922970a` (2026-10-02, verified on BscScan). Results of the first two guarded buys: `results/`, `IDEAS.md` §F11.

## What ShareGuard does
`swapForShares(tokenIn, amountIn, stock, minShares, router, routerData, recipient, deadline)` pulls
`tokenIn` from the caller, approves **exactly** `amountIn` to the router's approve target, runs the
**allow-listed** router with calldata built for the guard's address, converts what arrived into
**shares** (`tokens × multiplier / 1e18`), reverts below `minShares`, forwards the stock, refunds
unspent input, and resets the approval to 0. It holds no balance between transactions.

- **Multiplier sources:** bStock `uiMultiplier()` (on-chain); xStocks `multiplier()` (data only);
  **Ondo: a signed feed** (`swapForSharesWithFeed`, EIP-712 `FeedUpdate{stock, multiplier,
  validAfter, validUntil}` signed by `feedSigner`). Per asset `maxStepBps` (start 300): a decrease or
  a bigger increase is accepted only with an **owner-registered `CorporateAction`** that matches. A
  feed older than `maxAge` (3 days) reverts.
- **Pause checks (fail closed):** `Manager` = `manager.isTokenPaused(stock)` (Ondo reads the manager
  from `token.tokenPauseManager()`; **bStock has no getter**, so its shared manager
  `0x9fc7…700a` is configured per asset); `TokenFlag` = `token.isPaused()` (xStocks).
- **Owner (`Ownable2Step`):** manages routers, assets, corporate actions, feed signer, `maxAge`,
  global pause, `rescue`. It cannot move user funds (none are held) or change a multiplier alone.

## Offline tests (CI runs these)
Expect 72 passing; the 10 fork tests skip without `CAPTURE`.

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts && forge test
```

## Fork tests A–I (need an ARCHIVE BSC RPC; pinned to each capture's block)
```bash
BSC_RPC=<archive url> ./script/fork.sh
BSC_RPC=<archive url> ./script/fork.sh NVDAon
```
Fresh captures (on the Seoul EC2; read-only, nothing is signed), then replay:
```bash
./script/capture.sh NVDAB NVDAon
FORK_LATEST=1 BSC_RPC=<archive url> ./script/fork.sh NVDAB NVDAon
git add captures && git commit -m "fork captures" && git push
```

## Deploy (your machine only; the key never goes to the server or to git)
> Copy the commands **without** the `#` lines. Some terminals pass `# comment` text to the program as arguments, which breaks `gen_assets.py` and `forge script`.

You need: a deployer key funded with ≈0.0005 BNB (the dry run estimates 0.0003), the feed signer's
**address** (never its key; it must differ from the deployer), and a BscScan API key.
```bash
git clone --recurse-submodules <repo> && cd tally/contracts
# fresh Ondo seeds; the deploy script refuses seeds older than 2 hours
python3 tools/gen_assets.py NVDA AAPL TSLA QQQ SPY
export BSC_RPC=<url> FEED_SIGNER=0x<feed signer ADDRESS> BSCSCAN_API_KEY=<key>
# optional: hand ownership to another address (two-step: it must call acceptOwnership)
# export OWNER=0x<address>
read -rsp "Deployer key (0x…): " DEPLOYER_PK && echo && export DEPLOYER_PK

# 1) dry run: simulates on live state, prints each asset's multiplier and the gas cost, sends nothing
forge script script/Deploy.s.sol:Deploy --rpc-url $BSC_RPC -vv

# 2) deploy + verify on BscScan
forge script script/Deploy.s.sol:Deploy --rpc-url $BSC_RPC --broadcast \
  --verify --verifier etherscan --etherscan-api-key $BSCSCAN_API_KEY -vv
unset DEPLOYER_PK
```
If verification does not complete, verify by hand (constructor args are the deployer and the feed signer):
```bash
forge verify-contract <SHAREGUARD_ADDRESS> src/ShareGuard.sol:ShareGuard --chain 56 \
  --constructor-args $(cast abi-encode "constructor(address,address)" <DEPLOYER_ADDRESS> $FEED_SIGNER) \
  --verifier etherscan --etherscan-api-key $BSCSCAN_API_KEY --watch
```
Then push `contracts/broadcast/Deploy.s.sol/56/run-latest.json` (it holds transactions, no keys) and
set `SHAREGUARD_ADDRESS` in the server's env file.

## Two live guarded buys (Seoul EC2; M2 exit check 3)
Use the burner from the F6 spike (or a new one) holding ≥12 USDT and ≈0.002 BNB on BSC.
```bash
cd tally/contracts
export BINANCE_W3_API_KEY=… BINANCE_W3_API_SECRET=… BSC_RPC=<url>
read -rsp "Burner key: " PARITY_PK && echo && export PARITY_PK
PY=../spike/.venv/bin/python
$PY tools/guarded_buy.py --guard 0x<SHAREGUARD> --token NVDAB  --usdt 6
$PY tools/guarded_buy.py --guard 0x<SHAREGUARD> --token NVDAB  --usdt 6 --send
$PY tools/guarded_buy.py --guard 0x<SHAREGUARD> --token NVDAon --usdt 6 --send --sign-feed
unset PARITY_PK FEED_SIGNER_PK
git add results && git commit -m "M2: guarded buys" && git push
```
The tool re-quotes right before sending, estimates gas itself (×1.25, never the API's 450000),
simulates at that exact limit, refuses to send if the guard is paused/disabled or the API's router is
not on the allow list, and writes `results/guarded_*.json` with the decoded `Guarded` event. Without
`--sign-feed` an Ondo buy uses the guard's stored (owner-seeded) multiplier, valid for 3 days.

## Expanding the asset list (WO-09, 2026-10-08)

The deployed ShareGuard is unchanged. A keyless read at BSC block **126396848**
(2026-10-08 06:34:56 UTC) found **10 enabled tokens, five tickers**. The approved
addition manifest contains **20 new passing tokens: 12 bStock and 8 Ondo**, from
`captures/depth/batch-1-fork-selection.json`. Controls, held leveraged/inverse
products and failed captures are excluded from the owner additions. The existing
10-token configuration is retained as comparison metadata, never an owner batch.

- `script/AddAssets.s.sol` targets only the existing ShareGuard and this exact
  20-token manifest. Owner batches contain at most ten manifest entries. A token
  whose source is already configured is skipped, even when disabled. Issuer
  configuration matches `Deploy.s.sol`: bStock uses `UiMultiplier`, zero step and
  the shared pause manager; Ondo uses `Feed`, 300 bps and the token's own manager.
- Its keyless preview uses recorded Ondo multipliers exclusively in local
  simulation, prints their timestamp and reports each asset's multiplier, local
  call gas and pause state. This is not an owner seed recording. The real owner
  path requires positive Ondo seeds no more than two hours old, checks the whole
  batch before beginning, and never reads a key itself. Seeds remain pending the
  chief engineer's instruction.
- Rollback preserves the deployed asset configuration and feed while setting
  `enabled=false`, and is restricted to these 20 additions.
- `tools/gen_buyable.py` generates the planned list offline, using company names
  from the recorded registry. The target is 30 tokens across 21 tickers, including
  the existing five tickers. It is deliberately not connected to the product
  until the owner steps and enabled-list comparison pass; the product still uses
  its existing five-ticker list.
- `tools/list_enabled.py` reads configurations at one pinned public-chain block
  and compares both tokens and tickers in both directions, including disabled
  assets, issuer configuration differences and failed reads. Its coverage is the
  fixed 53-token Batch 1 registry; ShareGuard cannot enumerate unknown mapping
  keys. Before the owner steps, it correctly fails for the 20 missing additions.

Evidence: `captures/depth/batch-1-before-owner-20261008.json`,
`captures/depth/batch-1-keyless-preview-20261008.txt` and the addition fork test
report. The original 34 passing captures and their fork results remain unchanged.
The next batch's 19 overnight failures remain recorded in the selection report;
US-session retries are separate and cannot enter this owner manifest.

Owner and EC2 operations belong to the chief engineer. Run instructions are
maintained in [the deployment guide](../docs/deployment.md); the orchestrator
incorporates the exact commands from WO-09's PR. No owner transaction, seed
recording or live proof has been performed by Agent 09.
