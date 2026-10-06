#!/usr/bin/env bash
# Reload /etc/tally/tally.env and restart the Tally web server on the EC2.
#
#   ./deploy/restart.sh            reload the env and restart (no rebuild)
#   ./deploy/restart.sh --build    rebuild first (needed after changing NEXT_PUBLIC_PRIVY_APP_ID or any code)
#   ./deploy/restart.sh --update   git pull the current branch, install, rebuild, then restart
#
# When FEATURE_RECEIPTS=1 in the env file it also (re)starts `pnpm worker receipts`, the job that verifies sell and buy receipt hints.
# Run it as your normal user (not with sudo): it uses sudo only to read the root-only env file. It never prints secret values.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${TALLY_ENV_FILE:-/etc/tally/tally.env}"
PORT="${PORT:-3000}"
LOG="${TALLY_LOG:-$HOME/tally-web.log}"
WORKER_LOG="${TALLY_WORKER_LOG:-$HOME/tally-worker-receipts.log}"
MODE="${1:-}"

cd "$REPO"

load_env() {
  # Root-only file: read it with sudo, export every line into this shell.
  set -a
  # shellcheck disable=SC1090
  source <(sudo cat "$ENV_FILE")
  set +a
}

echo "==> loading $ENV_FILE"
load_env

if [[ "$MODE" == "--update" ]]; then
  echo "==> updating $(git rev-parse --abbrev-ref HEAD)"
  git pull --ff-only
  pnpm install --frozen-lockfile
fi

if [[ "$MODE" == "--update" || "$MODE" == "--build" ]]; then
  echo "==> building (NEXT_PUBLIC_* values are baked in here, so the env was loaded first)"
  pnpm build
fi

if [[ ! -f apps/web/.next/standalone/apps/web/server.js ]]; then
  echo "No build found. Run: ./deploy/restart.sh --build" >&2
  exit 1
fi

echo "==> checking the env (names only, never values)"
need() { [[ -n "${!1:-}" ]] && echo "   ok       $1" || echo "   MISSING  $1  $2"; }
need NEXT_PUBLIC_PRIVY_APP_ID "(sign-in will not work; rebuild with --build after setting it)"
need BINANCE_W3_API_KEY "(quotes will fail)"
need BINANCE_W3_API_SECRET "(quotes will fail)"
need BSC_RPC_PRIMARY "(falls back to public RPCs, which can answer 403; the name is BSC_RPC_PRIMARY, not BSC_RPC_URL)"
need FEED_SIGNER_PK "(Ondo buys fail once the on-chain multiplier is more than 3 days old)"
need TALLY_DATA_DIR "(fills, declarations and the Ondo baseline will not be saved)"
if [[ -n "${TALLY_DATA_DIR:-}" && ! -w "$TALLY_DATA_DIR" ]]; then
  echo "   NOT WRITABLE  $TALLY_DATA_DIR  -> run: sudo chown $(id -un):$(id -gn) $TALLY_DATA_DIR"
fi

echo "==> stopping anything on port $PORT"
fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
for _ in $(seq 1 20); do
  fuser "${PORT}/tcp" >/dev/null 2>&1 || break
  sleep 0.5
done

echo "==> starting the server (log: $LOG)"
PORT="$PORT" HOSTNAME=127.0.0.1 nohup node apps/web/.next/standalone/apps/web/server.js >"$LOG" 2>&1 &
echo "   pid $!"

# The receipts worker (needs the same env and TALLY_DATA_DIR as the web server). Stopped by name: the patterns are narrow
# (the pnpm wrapper and the tsx process it starts) and cannot match this script, whose command line is just restart.sh.
if pgrep -f 'worker receipts|src/cli\.ts receipts' >/dev/null 2>&1; then
  echo "==> stopping the receipts worker"
  pkill -f 'worker receipts|src/cli\.ts receipts' >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    pgrep -f 'worker receipts|src/cli\.ts receipts' >/dev/null 2>&1 || break
    sleep 0.5
  done
fi
if [[ "${FEATURE_RECEIPTS:-}" == "1" ]]; then
  echo "==> starting the receipts worker (log: $WORKER_LOG)"
  nohup pnpm worker receipts >"$WORKER_LOG" 2>&1 &
  echo "   pid $!"
else
  echo "==> receipts worker not started (FEATURE_RECEIPTS is not 1)"
fi

echo "==> waiting for it to answer"
up=""
for _ in $(seq 1 30); do
  if curl -s -o /dev/null -H 'cf-ipcountry: KR' "http://127.0.0.1:${PORT}/"; then up=1; break; fi
  sleep 1
done
if [[ -z "$up" ]]; then
  echo "The server did not come up. Last log lines:" >&2
  tail -n 25 "$LOG" >&2
  exit 1
fi

echo "==> health"
curl -s -H 'cf-ipcountry: KR' "http://127.0.0.1:${PORT}/api/health" || true
echo
echo
echo "Running. Logs: tail -f $LOG"
echo "Phone test tunnel (separate terminal): cloudflared tunnel --url http://localhost:${PORT}"
