#!/usr/bin/env bash
# Capture FRESH Trading API calldata for the fork tests. Run on the AWS Seoul EC2 (the authenticated
# API refuses US callers), then push contracts/captures/. Needs BINANCE_W3_API_KEY/SECRET and BSC_RPC
# in the environment (or it prompts). Uses the spike's capture_route.py: read-only, nothing is signed.
#   ./script/capture.sh NVDAB NVDAon            # default 6 USDT each
set -euo pipefail
cd "$(dirname "$0")/.."
tokens=("$@"); [ ${#tokens[@]} -gt 0 ] || tokens=(NVDAB NVDAon)
for t in "${tokens[@]}"; do
  python3 ../spike/capture_route.py --token "$t" --usdt 6 --out captures
done
echo "captured: ${tokens[*]}. Replay now (pinned to each capture's block):  BSC_RPC=<archive url> ./script/fork.sh ${tokens[*]}"
