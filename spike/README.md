# Parity spike: region check, ShareGuard fork test, first live buys

Goal: before building the app, prove three things on real infrastructure.

1. **The server region works.** The Trading API blocks by the *caller's* IP (`40304`), so the backend must sit in an allowed country. Target: AWS Seoul (South Korea is not on the hackathon's restricted list; Japan, the UK, the Netherlands, Canada and the US are).
2. **ShareGuard works with real routes.** Real API calldata is replayed on a BSC mainnet fork in three designs: plain wallet, ShareGuard as the trader, and an EIP-7702 batch (swap, then share check).
3. **A real buy goes through.** About $6 each of a bStock and an Ondo stock on mainnet, from a burner wallet.

Nothing here touches your main wallet. The fork test spends nothing. Only `live_buy.py --send` moves real funds, and it asks you to type a confirmation first.

| File | What it does |
|---|---|
| `setup.sh` | Installs git, python venv, Foundry, `eth-account`, forge-std. Builds and runs the offline unit tests. |
| `capture_route.py` | Read-only. Gets a real quote and swap calldata for the fork test's test wallet and for the ShareGuard address. |
| `run_fork_spike.sh` | Capture, then immediately replay on a fork, per token. Saves logs to `results/`. |
| `shareguard/` | `ShareGuard.sol`, `BatchExecutor.sol` (EIP-7702 delegate), unit tests (offline) and fork tests. |
| `live_buy.py` | Dry run by default. `--send` makes a real buy and records shares received and price per share. |
| `w3api.py` | Shared signed API client, RPC helpers, multiplier lookup. |

## 0. On the EC2 box (Ubuntu 24.04, Seoul)

```bash
ssh ubuntu@<your-ec2-ip>
git clone -b claude/loving-shannon-cqlztx https://github.com/deyoungjohn/find-out.git
cd find-out/spike
./setup.sh                      # finishes with "9 tests passed" and "Setup done." and returns to the prompt
export PATH="$HOME/.foundry/bin:$PATH"
```

If the repo is private, clone with a GitHub token or SSH key. 2 GB of RAM is enough; nothing here compiles anything large.

## 1. Load your API key without leaving it in shell history

```bash
read -rsp "API key: " BINANCE_W3_API_KEY && echo && export BINANCE_W3_API_KEY
read -rsp "API secret: " BINANCE_W3_API_SECRET && echo && export BINANCE_W3_API_SECRET
```
Nothing appears while you paste (the input is hidden on purpose). Paste, press Enter, and the next prompt appears.

Optional: a dedicated BSC RPC (a free NodeReal, Ankr or QuickNode key) is more reliable for forking than the public one:
`export BSC_RPC=https://...`

## 2. Region check from the server

```bash
python3 ../research/region_check.py --label ec2-seoul --geo
```

Expect `auth check: OK` and `caller_ip_country: KR`. If you get `40304`, Seoul is blocked too. Stop there and tell me; the backend region is then the first problem to solve.

## 3. Fork test: ShareGuard against real calldata

```bash
./run_fork_spike.sh             # NVDAB and NVDAon; or: ./run_fork_spike.sh NVDAB AAPLB NVDAon
```

Run it **twice**: once now, and once during US regular hours (13:30–20:00 UTC, Mon–Fri). On 1 Oct the API returned Ondo as plain `SWAP` in pre-market. During regular hours it may switch to real RFQ orders, and the fork test skips RFQ legs and says so.

How to read the five tests:

| Test | Question it answers | If it fails |
|---|---|---|
| A `replayAsPlainWallet` | Does API calldata replay on a fork at all? | The fork setup or quote expiry is the problem, not ShareGuard. Rerun. A and D need it. |
| B `guardWrapped` | Does the route work when a **contract** (ShareGuard) is the trader? | Wrapper design is out. The `FINDING:` line says why: RFQ leg bound to a wallet, router rejects contracts, or output sent elsewhere. |
| C `guardRejectsShortfall` | Does ShareGuard refuse a fill below the share minimum? | Only meaningful if B passed. |
| D `7702BatchSwapThenAssert` | Does the fallback (wallet batch: approve, unchanged API swap, share check) work? | If A passed but D failed, the 7702 path has a problem. |
| E `7702BatchRevertsAtomically` | Does an impossible share minimum undo the swap too? | Checks the batch fails at the share check (call 2), not at the swap (call 1). |

The decision this produces:
- **B passes:** ShareGuard as a router is viable.
- **Only D/E pass:** ship the EIP-7702 batch design. Then also check that Binance Wallet / Agentic Wallet can send 7702 batches.
- **Neither passes:** v1 uses pre-trade simulation plus a share-based minimum, with no on-chain guard.

## 4. Burner wallet for the live buys

```bash
.venv/bin/python -c "from eth_account import Account; a=Account.create(); print(a.address); print(a.key.hex())"
```

Save the key in a password manager, then clear the terminal. Fund the address on **BSC (BEP-20)** with about **15 USDT and 0.002 BNB**. That covers two $6 buys plus gas; each transaction costs a few cents.

## 5. Live buys (dry run first)

```bash
read -rsp "Burner private key: " PARITY_PK && echo && export PARITY_PK   # never your main wallet
.venv/bin/python live_buy.py --token NVDAB  --usdt 6          # dry run: balances, quote, route, simulation
.venv/bin/python live_buy.py --token NVDAB  --usdt 6 --send   # type "BUY NVDAB" to confirm
.venv/bin/python live_buy.py --token NVDAon --usdt 6 --send   # type "BUY NVDAon"
unset PARITY_PK
```

The first `--send` per wallet sends an exact-amount USDT approval, then the swap. The script re-quotes after you confirm, estimates the real gas (the API's `gas` is always 450000, too low for multi-hop routes), and simulates at that exact limit before sending. If anything would revert, it stops without sending. Each run saves `results/live_<token>_*.json` with the BscScan link, tokens and **shares** received, USDT per share, premium vs the US reference price, and gas. If the API answers with RFQ instead of SWAP, the script stops before spending and saves the RFQ payload. That alone is a finding.

## 6. Bring the results back

Upload everything in `spike/results/` here (or commit and push it to the branch). I'll write the findings into `IDEAS.md`.

## Safety notes
- The key is only read from `PARITY_PK` or a hidden prompt, and is never printed or saved. `live_buy.py` refuses amounts above 10 USDT. Ondo quotes need at least $5 (`40375`), and 5 USDT is worth slightly less, so the default is 6.
- Approvals are for the exact amount, not unlimited.
- `ShareGuard` and `BatchExecutor` are **unaudited spike code**. They're deployed only inside the fork test; don't deploy them to mainnet with real funds yet.
