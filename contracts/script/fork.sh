#!/usr/bin/env bash
# Run fork tests A-I against every capture in contracts/captures/ (or the ones you name).
#   BSC_RPC=<archive RPC url> ./script/fork.sh            # all captures, pinned to each capture's block
#   BSC_RPC=... ./script/fork.sh NVDAB                    # one token
#   FORK_LATEST=1 BSC_RPC=... ./script/fork.sh NVDAB      # fork the tip, for a capture made seconds ago
# The RPC must be an ARCHIVE node (pinned forks read state from old blocks).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
: "${BSC_RPC:?set BSC_RPC to an archive-capable BSC RPC url}"
tokens=("$@")
if [ ${#tokens[@]} -eq 0 ]; then
  for f in captures/*.json; do tokens+=("$(basename "$f" .json)"); done
fi
fail=0
for t in "${tokens[@]}"; do
  echo "=== fork tests A-I: $t"
  CAPTURE="captures/$t.json" forge test --match-contract ShareGuardForkTest -vv || fail=1
done
exit $fail
