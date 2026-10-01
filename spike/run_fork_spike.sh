#!/usr/bin/env bash
# Capture fresh Trading API calldata and immediately replay it on a BSC mainnet fork.
# Usage: ./run_fork_spike.sh [TOKEN ...]   (default: NVDAB NVDAon)
# Needs BINANCE_W3_API_KEY / BINANCE_W3_API_SECRET exported; BSC_RPC optional.
set -uo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.foundry/bin:$PATH"
export BSC_RPC="${BSC_RPC:-https://bsc-rpc.publicnode.com}"
# Ondo quotes need >= 5 USD; 5 USDT is slightly less (USDT ~ $0.9995), so default to 6.
USDT_AMOUNT="${USDT_AMOUNT:-6}"
mkdir -p results
(cd shareguard && forge build >/dev/null)   # compile first so replay starts right after capture

for t in ${@:-NVDAB NVDAon}; do
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  echo "================ $t ($stamp UTC)"
  python3 capture_route.py --token "$t" --usdt "$USDT_AMOUNT" || { echo "capture failed for $t"; continue; }
  cp "captures/$t.json" "results/capture_${t}_${stamp}.json"
  (cd shareguard && CAPTURE="../captures/$t.json" forge test --match-contract Fork -vv) \
    2>&1 | tee "results/fork_${t}_${stamp}.log"
done
echo
echo "Logs and captures are in spike/results/. Upload or commit them so the findings can go into IDEAS.md."
