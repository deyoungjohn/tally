#!/usr/bin/env bash
# One-time setup for the Parity spike on Ubuntu 24.04 (tested target: 2 GB EC2).
set -euo pipefail
cd "$(dirname "$0")"

sudo apt-get update -y
sudo apt-get install -y git curl python3-venv

if ! command -v forge >/dev/null 2>&1 && [ ! -x "$HOME/.foundry/bin/forge" ]; then
  curl -L https://foundry.paradigm.xyz | bash
  "$HOME/.foundry/bin/foundryup"
fi
export PATH="$HOME/.foundry/bin:$PATH"

python3 -m venv .venv
.venv/bin/pip install --quiet eth-account

cd shareguard
[ -d lib/forge-std ] || forge install foundry-rs/forge-std --no-git
forge build
forge test --match-contract Unit   # offline: contract logic + EIP-7702 batch mechanics
echo
echo "Setup done. Add Foundry to PATH in new shells:  export PATH=\"\$HOME/.foundry/bin:\$PATH\""
