#!/usr/bin/env bash
# Chief-engineer EC2 entry point. Fixed list only; quotes/builds only, no signing.
# A failed asset does not stop subsequent assets. New run IDs preserve evidence.
set -euo pipefail
set +x
contracts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
list_file="$contracts_dir/deploy/batch-1.json"
run_id="batch1-$(date -u +%Y%m%dT%H%M%SZ)"
request_interval=0.5
premium_limit_pct=1.5
dry_run=()
while (($#)); do
  case "$1" in
    --list|--run-id|--request-interval|--premium-limit-pct)
      if (($# < 2)); then echo "missing value for $1" >&2; exit 2; fi
      case "$1" in
        --list) list_file="$2" ;;
        --run-id) run_id="$2" ;;
        --request-interval) request_interval="$2" ;;
        --premium-limit-pct) premium_limit_pct="$2" ;;
      esac
      shift 2 ;;
    --dry-run) dry_run=(--dry-run); shift ;;
    *) echo "unknown argument; expected --list, --run-id, --request-interval, --premium-limit-pct or --dry-run" >&2; exit 2 ;;
  esac
done
recorder="$contracts_dir/tools/capture_batch.py"
token_text="$(python3 "$recorder" --list "$list_file" --list-tokens)"
mapfile -t tokens <<< "$token_text"
completed=0
failed=0
echo "Batch 1 run: $run_id; 43 candidates + 10 controls; held products last; fork/enablement pending"
for token in "${tokens[@]}"; do
  if python3 "$recorder" --list "$list_file" --token "$token" --run-id "$run_id" \
      --request-interval "$request_interval" --premium-limit-pct "$premium_limit_pct" "${dry_run[@]}"; then
    completed=$((completed + 1))
  else
    failed=$((failed + 1))
    echo "$token recorder returned failure; continuing" >&2
  fi
  if ((${#dry_run[@]} == 0)); then sleep 1; fi
done
echo "Batch 1 complete: $completed successful recorder calls, $failed failed; run=$run_id; fork/enablement pending"
if ((failed)); then exit 1; fi
