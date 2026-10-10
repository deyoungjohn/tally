#!/usr/bin/env bash
# Reload /etc/tally/tally.env, then (re)start the Tally web server and every worker the env file's flags call for.
# Full instructions: docs/deployment.md (that file is the single source of truth for deploying Tally).
#
#   ./deploy/restart.sh                 reload the env and restart web + the workers the FEATURE_* flags need (no rebuild)
#   ./deploy/restart.sh --build         rebuild first (needed after changing NEXT_PUBLIC_PRIVY_APP_ID or any code)
#   ./deploy/restart.sh --update        git pull the current branch, install, rebuild, then restart
#   ./deploy/restart.sh --plan          show what would run and the memory left, start nothing
#   ./deploy/restart.sh --status        show every service: running or not, memory, uptime, log file
#   ./deploy/restart.sh --stop          stop the web server and every worker this script manages
#   ./deploy/restart.sh --ensure        start only what is wanted but not running (for cron: crash and reboot recovery, see docs/deployment.md)
#   --only a,b   run only these services        --skip a,b   leave these out        --mcp   also start the hosted MCP (HTTP)
#   --force      start even when memory is low  (default: a service is skipped when under TALLY_MIN_FREE_MB, 150, is free)
#
# Run it as your normal user (not with sudo): it uses sudo only to read the root-only env file. It never prints secret values.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${TALLY_ENV_FILE:-/etc/tally/tally.env}"
PORT="${PORT:-3000}"
LOG="${TALLY_LOG:-$HOME/tally-web.log}"
RUN_DIR="${TALLY_RUN_DIR:-$HOME/.tally-run}"
LOG_DIR="${TALLY_LOG_DIR:-$HOME}"
MIN_FREE_MB="${TALLY_MIN_FREE_MB:-150}"
EST_MB="${TALLY_EST_MB:-150}"
STAGGER_S="${TALLY_STAGGER_S:-3}"

MODE=""; ONLY=""; SKIP=""; WANT_MCP=0; FORCE=0; ACTION="restart"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build|--update) MODE="$1" ;;
    --plan) ACTION="plan" ;;
    --status) ACTION="status" ;;
    --stop) ACTION="stop" ;;
    --ensure) ACTION="ensure" ;;
    --mcp) WANT_MCP=1 ;;
    --force) FORCE=1 ;;
    --only) ONLY="${2:-}"; shift ;;
    --skip) SKIP="${2:-}"; shift ;;
    -h|--help) sed -n 2,17p "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

cd "$REPO"
mkdir -p "$RUN_DIR"

ALL_SERVICES=(receipts collect-registry collect-prices statement collect-flow flow guardian bot autopilot prune mcp)

in_list() { [[ ",$2," == *",$1,"* ]]; }
flag() { local v="FEATURE_$1"; [[ "${!v:-}" == "1" ]]; }
avail_mb() { awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0; }
pidfile() { echo "$RUN_DIR/$1.pid"; }
logfile() { echo "$LOG_DIR/tally-$1.log"; }
alive() { local f; f="$(pidfile "$1")"; [[ -f "$f" ]] && kill -0 "$(cat "$f")" 2>/dev/null; }
rss_mb() { local p; p="$(cat "$(pidfile "$1")")"; ps -eo pgid=,rss= | awk -v g="$p" '$1==g {s+=$2} END {print int(s/1024)}'; }

# One run at a time: cron's --ensure must never race a manual restart.
take_lock() { exec 9>"$RUN_DIR/script.lock"; if [[ "$1" == "nowait" ]]; then flock -n 9 || { echo "another run is in progress; nothing to do"; exit 0; }; else flock -w 300 9 || { echo "another run is holding the lock" >&2; exit 1; }; fi; }
# Crash-loop guard: at most 5 automatic restarts of one service in 15 minutes, then --ensure gives up on it.
restarts_file() { echo "$RUN_DIR/$1.restarts"; }
recent_restarts() { local f now; f="$(restarts_file "$1")"; now="$(date +%s)"; [[ -f "$f" ]] || { echo 0; return; }; awk -v n="$now" 'n-$1<900 {c++} END {print c+0}' "$f"; }
note_restart() { date +%s >> "$(restarts_file "$1")"; }
gave_up() { (( $(recent_restarts "$1") >= 5 )); }
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

load_env() {
  # Root-only file: read it with sudo (or directly when it is readable), export every line into this shell.
  set -a
  if [[ -r "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
  else
    # No terminal (cron): sudo must not ask for a password, so it needs the NOPASSWD rule in docs/deployment.md.
    local SUDO=(sudo); [[ -t 0 ]] || SUDO=(sudo -n)
    # shellcheck disable=SC1090
    source <("${SUDO[@]}" cat "$ENV_FILE")
  fi
  set +a
}

# --- which services do the flags call for? (priority order: when memory runs short, the later ones are skipped) ------
declare -A WHY=()
compute_services() {
  local any_reader=0 s
  for s in statement flow guardian autopilot; do flag "${s^^}" && any_reader=1; done
  WANTED=()
  add() { WANTED+=("$1"); WHY["$1"]="$2"; }
  if flag RECEIPTS || flag QUALITY; then add receipts "FEATURE_RECEIPTS or FEATURE_QUALITY"; fi
  if (( any_reader )); then add collect-registry "feeds statement/flow/guardian/autopilot"; add collect-prices "feeds statement/flow/guardian/autopilot"; fi
  if flag STATEMENT; then add statement "FEATURE_STATEMENT"; fi
  if flag FLOW; then add collect-flow "FEATURE_FLOW"; add flow "FEATURE_FLOW"; fi
  if flag GUARDIAN; then
    add guardian "FEATURE_GUARDIAN"
    if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then add bot "FEATURE_GUARDIAN and TELEGRAM_BOT_TOKEN set"; else [[ "$ACTION" == "ensure" ]] || echo "   note: no TELEGRAM_BOT_TOKEN, the Telegram bot will not run"; fi
  fi
  if flag AUTOPILOT; then add autopilot "FEATURE_AUTOPILOT (shadow mode, executes nothing)"; fi
  if (( ${#WANTED[@]} > 0 )); then add prune "deletes old snapshots; keeps the store from growing forever"; fi
  if (( WANT_MCP )); then add mcp "--mcp (hosted MCP over HTTP)"; fi
  local filtered=() w
  for w in "${WANTED[@]}"; do
    if [[ -n "$ONLY" ]] && ! in_list "$w" "$ONLY"; then continue; fi
    if [[ -n "$SKIP" ]] && in_list "$w" "$SKIP"; then continue; fi
    filtered+=("$w")
  done
  WANTED=("${filtered[@]}")
}

# --- command for a service: runs the tsx binary directly (no pnpm wrapper process: it costs memory) ----------------
service_dir() { case "$1" in bot) echo apps/bot;; mcp) echo packages/mcp;; *) echo apps/worker;; esac; }
service_args() { case "$1" in bot) echo "src/main.ts";; mcp) echo "src/index.ts --http";; *) echo "src/cli.ts $1";; esac; }

start_service() {
  local name="$1" dir args log pf
  dir="$(service_dir "$name")"; args="$(service_args "$name")"; log="$(logfile "$name")"; pf="$(pidfile "$name")"
  if [[ "$name" == "mcp" && ! -f packages/mcp/src/http.ts ]]; then echo "   SKIPPED  mcp  (this checkout has no HTTP transport yet: packages/mcp/src/http.ts)"; return 1; fi
  if (( ! FORCE )); then
    local free; free="$(avail_mb)"
    if (( free < MIN_FREE_MB )); then echo "   SKIPPED  $name  (only ${free} MB free, under TALLY_MIN_FREE_MB=$MIN_FREE_MB; use --force or free memory)"; return 1; fi
  fi
  local runner=("$REPO/$dir/node_modules/.bin/tsx")
  [[ -x "${runner[0]}" ]] || runner=(pnpm --silent exec tsx)
  (
    cd "$REPO/$dir"
    if [[ "$name" == "mcp" ]]; then export TALLY_MCP_HTTP=1; fi
    # shellcheck disable=SC2086
    setsid nohup "${runner[@]}" $args >"$log" 2>&1 < /dev/null 9>&- &
    echo $! > "$pf"
  )
  echo "   started  $name  (pid $(cat "$pf"), log $log)"
  sleep "$STAGGER_S"
}

stop_service() {
  local name="$1" pf p i; pf="$(pidfile "$name")"
  if [[ -f "$pf" ]]; then
    p="$(cat "$pf")"
    if kill -0 "$p" 2>/dev/null; then
      kill -TERM -- "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null || true
      for i in $(seq 1 20); do kill -0 "$p" 2>/dev/null || break; sleep 0.5; done
      kill -0 "$p" 2>/dev/null && { kill -KILL -- "-$p" 2>/dev/null || true; }
      echo "   stopped  $name"
    fi
    rm -f "$pf"
  fi
  # A copy started by hand in an older way (`pnpm worker <job>`). The patterns are narrow and cannot match this script.
  if [[ "$name" != "mcp" && "$name" != "bot" ]] && pgrep -f "worker $name( |\$)|src/cli\\.ts $name( |\$)" >/dev/null 2>&1; then
    pkill -f "worker $name( |\$)|src/cli\\.ts $name( |\$)" >/dev/null 2>&1 || true
    echo "   stopped  $name  (an older hand-started copy)"
  fi
}

stop_web() {
  fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do fuser "${PORT}/tcp" >/dev/null 2>&1 || break; sleep 0.5; done
}

start_web() {
  if [[ ! -f apps/web/.next/standalone/apps/web/server.js ]]; then echo "No build found. Run: ./deploy/restart.sh --build" >&2; return 1; fi
  PORT="$PORT" HOSTNAME=127.0.0.1 nohup node apps/web/.next/standalone/apps/web/server.js >"$LOG" 2>&1 9>&- &
  echo "   web pid $!"
}
web_answers() { curl -s -m 5 -o /dev/null -H 'cf-ipcountry: KR' "http://127.0.0.1:${PORT}/"; }

show_status() {
  printf '%-18s %-8s %-8s %-9s %s\n' SERVICE STATE MEM_MB UPTIME_S LOG
  local n pf st mem up
  for n in "${ALL_SERVICES[@]}"; do
    pf="$(pidfile "$n")"
    if alive "$n"; then
      mem="$(rss_mb "$n")"; up="$(ps -o etimes= -p "$(cat "$pf")" | tr -d ' ')"; st="running"
    elif [[ -f "$pf" ]]; then st="DEAD"; mem="-"; up="-"; gave_up "$n" && st="GAVE UP"
    else st="off"; mem="-"; up="-"; fi
    printf '%-18s %-8s %-8s %-9s %s\n' "$n" "$st" "$mem" "$up" "$(logfile "$n")"
  done
  if fuser "${PORT}/tcp" >/dev/null 2>&1; then echo "web                running  (port $PORT, log $LOG)"; else echo "web                OFF      (port $PORT)"; fi
  echo "free memory: $(avail_mb) MB   (free -h for swap)"
}

case "$ACTION" in
  ensure) take_lock nowait ;;
  restart|stop) take_lock wait ;;
esac
if [[ "$ACTION" == "ensure" && -f "$RUN_DIR/stopped" ]]; then exit 0; fi   # you ran --stop: stay stopped until the next restart

[[ "$ACTION" == "ensure" ]] || echo "==> loading $ENV_FILE"
load_env

# A wrong or missing variable name once left the web server running with no Binance credentials for hours (BINANCE_WEB3_* instead of
# BINANCE_W3_*), so refuse to start anything until the names the code reads are present. Not needed to look or to stop.
check_env() {
  [[ "${TALLY_FIXTURES:-}" == "1" ]] && return 0
  local missing=() v
  for v in BINANCE_W3_API_KEY BINANCE_W3_API_SECRET TALLY_DATA_DIR; do
    [[ -n "${!v:-}" ]] || missing+=("$v")
  done
  # Missing but survivable (public RPC fallback; sign-in is off without the Privy id): warn, still start.
  for v in BSC_RPC_PRIMARY NEXT_PUBLIC_PRIVY_APP_ID; do
    [[ -n "${!v:-}" ]] || echo "$(stamp) WARNING: $v is not set in $ENV_FILE" >&2
  done
  (( ${#missing[@]} == 0 )) && return 0
  echo "$(stamp) REFUSING TO START: missing in $ENV_FILE: ${missing[*]}" >&2
  # Names that look like the right ones but are not what the code reads (names only, never values).
  local similar; similar=$(compgen -v | grep -E '^(BINANCE_|BSC_RPC|PRIVY|TALLY_DATA)' | grep -vxE 'BINANCE_W3_API_KEY|BINANCE_W3_API_SECRET|BSC_RPC_PRIMARY|TALLY_DATA_DIR' || true)
  [[ -n "$similar" ]] && echo "   set in the file but not read by Tally: $(echo $similar | tr '\n' ' ')" >&2
  echo "   fix the names in $ENV_FILE (see docs/deployment.md, Environment), then run ./deploy/restart.sh" >&2
  exit 1
}
case "$ACTION" in status|stop) ;; *) check_env ;; esac

case "$ACTION" in
  status) show_status; exit 0 ;;
  stop)
    echo "==> stopping workers"
    for n in "${ALL_SERVICES[@]}"; do stop_service "$n"; done
    echo "==> stopping the web server"; stop_web
    touch "$RUN_DIR/stopped"
    echo "Stopped. Cron's --ensure will leave everything stopped until the next ./deploy/restart.sh."; exit 0 ;;
  ensure)
    compute_services
    if ! web_answers; then
      if gave_up web; then
        [[ -f "$RUN_DIR/web.gaveup" ]] || { echo "$(stamp) GAVE UP on web (5 restarts in 15 min); fix it, then run ./deploy/restart.sh"; touch "$RUN_DIR/web.gaveup"; }
      else
        echo "$(stamp) web is not answering: restarting it"
        stop_web; note_restart web; start_web || true
      fi
    fi
    for w in "${WANTED[@]}"; do
      alive "$w" && continue
      if gave_up "$w"; then
        [[ -f "$RUN_DIR/$w.gaveup" ]] || { echo "$(stamp) GAVE UP on $w (5 restarts in 15 min); read $(logfile "$w"), then run ./deploy/restart.sh"; touch "$RUN_DIR/$w.gaveup"; }
        continue
      fi
      echo "$(stamp) $w is not running: starting it"
      if start_service "$w"; then note_restart "$w"; fi
    done
    exit 0 ;;
  plan)
    compute_services
    echo "==> plan (nothing is started)"
    echo "   free memory now: $(avail_mb) MB; estimate per worker: ${EST_MB} MB (an estimate, check --status after a start)"
    echo "   web server: always"
    for w in "${WANTED[@]}"; do echo "   $w  <- ${WHY[$w]}"; done
    echo "   total estimate for ${#WANTED[@]} services: $(( ${#WANTED[@]} * EST_MB )) MB"
    (( ${#WANTED[@]} * EST_MB > $(avail_mb) )) && echo "   WARNING: that is more than the memory free now; later services will be skipped, or the machine will swap."
    exit 0 ;;
esac

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
need FEED_SIGNER_PK "(Ondo buys fail once the onchain multiplier is more than 3 days old)"
need TALLY_DATA_DIR "(fills, declarations and the Ondo baseline will not be saved)"
if [[ -n "${TALLY_DATA_DIR:-}" && ! -w "$TALLY_DATA_DIR" ]]; then
  echo "   NOT WRITABLE  $TALLY_DATA_DIR  -> run: sudo chown $(id -un):$(id -gn) $TALLY_DATA_DIR"
fi
if flag GUARDIAN || flag STATEMENT; then need PRIVY_APP_SECRET "(session checks for Guardian and wallet registration will refuse everyone)"; fi
if flag GUARDIAN; then need TELEGRAM_BOT_TOKEN "(the Telegram bot will not start)"; fi
if (( WANT_MCP )); then need TALLY_MCP_HTTP_KEY "(optional shared key; without it anyone outside the blocked regions can call the MCP)"; fi
if [[ "${TALLY_FIXTURES:-}" == "1" ]]; then echo "   WARNING  TALLY_FIXTURES=1 is set: the app serves recorded data. Never leave it set in production."; fi
if [[ "${TALLY_ALLOW_MISSING_GEO:-}" == "1" ]]; then echo "   WARNING  TALLY_ALLOW_MISSING_GEO=1 is set: the region gate is open without Cloudflare. Local testing only."; fi
if [[ "${TALLY_DEV_PREVIEWS:-}" == "1" ]]; then echo "   WARNING  TALLY_DEV_PREVIEWS=1 is set: the /dev pages are public. Unset it before judging."; fi

rm -f "$RUN_DIR/stopped" "$RUN_DIR"/*.restarts "$RUN_DIR"/*.gaveup
echo "==> stopping the old processes"
for n in "${ALL_SERVICES[@]}"; do stop_service "$n"; done
echo "   web server on port $PORT"; stop_web

echo "==> starting the web server (log: $LOG)"
start_web

compute_services
echo "==> starting ${#WANTED[@]} worker services, ${STAGGER_S}s apart (free memory: $(avail_mb) MB)"
STARTED=()
for w in "${WANTED[@]}"; do
  if start_service "$w"; then STARTED+=("$w"); fi
done

echo "==> waiting for the web server to answer"
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

echo "==> checking the workers are still alive"
sleep 3
BAD=0
for w in "${STARTED[@]}"; do
  if ! alive "$w"; then BAD=1; echo "   DIED  $w  last log lines:"; tail -n 4 "$(logfile "$w")" | sed 's/^/        /'; fi
done
echo
show_status
echo
echo "==> health"
curl -s -H 'cf-ipcountry: KR' "http://127.0.0.1:${PORT}/api/health" || true
echo
echo
echo "Running. Web log: tail -f $LOG   Worker logs: $LOG_DIR/tally-<name>.log   Status: ./deploy/restart.sh --status"
echo "Phone test tunnel (separate terminal): cloudflared tunnel --url http://localhost:${PORT}"
(( BAD )) && { echo "One or more services died; see above." >&2; exit 1; }
exit 0
