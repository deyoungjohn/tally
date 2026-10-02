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
```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts && forge test            # 72 pass; the 10 fork tests skip without CAPTURE
```

## Fork tests A–I (need an ARCHIVE BSC RPC; pinned to each capture's block)
```bash
BSC_RPC=<archive url> ./script/fork.sh            # every capture in captures/
BSC_RPC=<archive url> ./script/fork.sh NVDAon     # one
```
Fresh captures (on the Seoul EC2; read-only, nothing is signed), then replay:
```bash
./script/capture.sh NVDAB NVDAon
FORK_LATEST=1 BSC_RPC=<archive url> ./script/fork.sh NVDAB NVDAon   # tip of the chain, for a capture made seconds ago
git add captures && git commit -m "fork captures" && git push
```

## Deploy (your machine only; the key never goes to the server or to git)
You need: a deployer key funded with ≈0.0005 BNB (the dry run estimates 0.0003), the feed signer's
**address** (never its key; it must differ from the deployer), and a BscScan API key.
```bash
git clone --recurse-submodules <repo> && cd tally/contracts
python3 tools/gen_assets.py NVDA AAPL TSLA QQQ SPY      # fresh Ondo seeds; the script refuses seeds > 2 h old
export BSC_RPC=<url> FEED_SIGNER=0x<feed signer ADDRESS> BSCSCAN_API_KEY=<key>
# export OWNER=0x<address>   # optional: hand ownership over (two-step: that address must call acceptOwnership)
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
cd tally/contracts            # on the EC2, after `git pull`
export BINANCE_W3_API_KEY=… BINANCE_W3_API_SECRET=… BSC_RPC=<url>      # or let the scripts prompt
read -rsp "Burner key: " PARITY_PK && echo && export PARITY_PK
PY=../spike/.venv/bin/python
$PY tools/guarded_buy.py --guard 0x<SHAREGUARD> --token NVDAB  --usdt 6                 # dry run
$PY tools/guarded_buy.py --guard 0x<SHAREGUARD> --token NVDAB  --usdt 6 --send
$PY tools/guarded_buy.py --guard 0x<SHAREGUARD> --token NVDAon --usdt 6 --send --sign-feed   # asks for FEED_SIGNER_PK (hidden)
unset PARITY_PK FEED_SIGNER_PK
git add results && git commit -m "M2: guarded buys" && git push
```
The tool re-quotes right before sending, estimates gas itself (×1.25, never the API's 450000),
simulates at that exact limit, refuses to send if the guard is paused/disabled or the API's router is
not on the allow list, and writes `results/guarded_*.json` with the decoded `Guarded` event. Without
`--sign-feed` an Ondo buy uses the guard's stored (owner-seeded) multiplier, valid for 3 days.
