# Deploying and running Tally

**This is the only place deployment instructions live.** Every instruction about running Tally on a server or a laptop (scripts, workers, feature flags, environment, tunnel, crash recovery, hosting the MCP) is written here and nowhere else. If you change a deploy script, an environment variable or a service, update this file in the same change. The orchestrator reads it from time to time and deletes any conflicting instruction found elsewhere.

## First time on the EC2 (Ubuntu 24.04, Seoul)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs git
sudo corepack enable && sudo corepack prepare pnpm@10.28.0 --activate
sudo mkdir -p /etc/tally /var/lib/tally && sudo chown "$USER":"$USER" /var/lib/tally
curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i /tmp/cloudflared.deb   # arm64 build on Graviton: check `uname -m`
git clone https://github.com/deyoungjohn/tally.git ~/tally && cd ~/tally
pnpm install --frozen-lockfile
```

Create `/etc/tally/tally.env` (root-only, mode 600) from the names in `deploy/tally.env.example`, then `./deploy/restart.sh --build`. The 4 GB swap file is already set up. Secrets live only in that file: never in git, never in chat.

## Day to day

Run as your normal user, from `~/tally`, never with sudo:

| Command | What it does |
|---|---|
| `./deploy/restart.sh` | Reload `/etc/tally/tally.env`, restart the web server and **every worker the flags call for**. No rebuild. |
| `./deploy/restart.sh --build` | Rebuild first. Needed after changing `NEXT_PUBLIC_PRIVY_APP_ID` or any code. |
| `./deploy/restart.sh --update` | `git pull --ff-only`, install, rebuild, restart. |
| `./deploy/restart.sh --plan` | Show what would run and the memory left. Starts nothing. Run it before a restart. |
| `./deploy/restart.sh --status` | Table of every service: running, DEAD, GAVE UP or off, memory, uptime, log file. |
| `./deploy/restart.sh --stop` | Stop the web server and every worker. Cron recovery stays off until the next restart. |
| `./deploy/restart.sh --ensure` | Start only what is wanted but not running (this is what cron runs). |
| `--only a,b` / `--skip a,b` | Run only, or leave out, the named services. |
| `--mcp` | Also start the hosted MCP over HTTP (needs `packages/mcp/src/http.ts`, WO-05 slice C). |
| `--force` | Start a service even when memory is under the limit. |

Logs: web `~/tally-web.log`; every worker `~/tally-<name>.log`; PID files and recovery state in `~/.tally-run/`. Never start workers by hand next to this script.

## What the flags start

Set `FEATURE_<NAME>=1` in `/etc/tally/tally.env` (only `1` turns a flag on; the default is off), then run `./deploy/restart.sh`. You never list workers by hand.

| Flag | Workers started (priority order) |
|---|---|
| `FEATURE_RECEIPTS` or `FEATURE_QUALITY` | `receipts` |
| `FEATURE_STATEMENT`, `FEATURE_FLOW`, `FEATURE_GUARDIAN` or `FEATURE_AUTOPILOT` | `collect-registry`, `collect-prices` (they feed the others) |
| `FEATURE_STATEMENT` | `statement` |
| `FEATURE_FLOW` | `collect-flow`, `flow` |
| `FEATURE_GUARDIAN` | `guardian`, and `bot` when `TELEGRAM_BOT_TOKEN` is set (also requires `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` for the UI button, rebuild needed) |
| `FEATURE_AUTOPILOT` | `autopilot` (collects positions for wallets that saved a policy, then records shadow decisions; executes nothing) |
| any worker above | `prune` (deletes old snapshots; without it the store grows forever) |
| `--mcp` | `mcp` |

`FEATURE_SELL` has no worker: it only enables the sell screens and route. `FEATURE_SWITCH` enables the Migrate entry (guided two-step migration between issuers, WO-13) and has no worker. `FEATURE_PIES` and `FEATURE_REWARDS` have none either.

## Memory (the EC2 has 1.9 GB of RAM and 4 GB of swap)

Each worker is a Node process, estimated at about 150 MB (an estimate; check `--status`). The script starts workers 3 seconds apart in priority order and **skips a service when under 150 MB is free** (`TALLY_MIN_FREE_MB`), saying so. A skipped service is not running, so read the output. If it skips something you need: `--skip` what you don't need, free memory, or move to a 4 GB instance for demo week. One process running all enabled jobs would use far less; it is not built.

## Crash and reboot recovery

Nothing restarts a crashed process by itself. Set this up once so no one has to watch:

1. Let cron read the root-only env file without a password (this allows only `cat` of that one file):
   ```bash
   echo "$USER ALL=(root) NOPASSWD: /usr/bin/cat /etc/tally/tally.env" | sudo tee /etc/sudoers.d/tally-env
   sudo chmod 440 /etc/sudoers.d/tally-env && sudo visudo -cf /etc/sudoers.d/tally-env
   ```
2. `crontab -e`, then add (first run `echo $PATH` and paste its output in place of `<PATH>`, so cron can find `node` and `pnpm`):
   ```cron
   PATH=<PATH>
   * * * * * cd ~/tally && ./deploy/restart.sh --ensure >> ~/.tally-run/ensure.log 2>&1
   @reboot sleep 45 && cd ~/tally && ./deploy/restart.sh --ensure >> ~/.tally-run/ensure.log 2>&1
   ```

What it does, every minute: if the web server does not answer, restart it; start any wanted worker that is not running; stay silent when everything is fine. It never runs two copies at once and respects the memory limit.

Limits, so you know what is not covered:
- **Crash loop guard.** A service restarted 5 times in 15 minutes is given up on (`GAVE UP` in `--status` and one line in `ensure.log`), so a worker with bad credentials does not hammer Binance. Read its log, fix it, run `./deploy/restart.sh`.
- **After `--stop`** it stays stopped until the next `./deploy/restart.sh` (otherwise cron would undo your stop).
- **The quick tunnel is not covered.** If `cloudflared` dies the public URL is gone and a new one breaks `TALLY_APP_ORIGIN` and the Privy allowed origins. Only the fixed domain with a named tunnel (below) fixes that.
- **A worker that is alive but stuck** is not restarted. Jobs have timeouts, and `/api/modules/health` shows a stale job, but nothing acts on it.
- **Nobody is told.** Check `./deploy/restart.sh --status` or `tail ~/.tally-run/ensure.log`.

## Disk (the EC2 filled up on 8 Oct 2026)

Check `df -h /` after every restart. The store is `/var/lib/tally/tally.db`; it must stay well under 2 GB. A `flow` snapshot is about 1.6 MB, so an hour of them is about 1.5 GB, and until the shorter flow retention is merged (`docs/prompts/wo04-flow-retention.md`) nothing removes them for 7 days. Until then, install this script and run it every 15 minutes as root. It keeps 30 minutes of flow rows (readers need 15) and always the newest row per token; SQLite reuses the freed pages, so the file stops growing.

```bash
sudo tee /usr/local/bin/tally-flow-prune.sh >/dev/null <<'EOF'
#!/bin/sh
K="kind IN ('flow','flow-traders','flow-holders','flow-pools')"
sqlite3 -cmd ".timeout 5000" /var/lib/tally/tally.db "DELETE FROM snapshots WHERE $K AND observed_at < (strftime('%s','now') - 1800) * 1000 AND id NOT IN (SELECT max(id) FROM snapshots WHERE $K GROUP BY kind, key);"
EOF
sudo chmod +x /usr/local/bin/tally-flow-prune.sh
(sudo crontab -l 2>/dev/null; echo '*/15 * * * * /usr/local/bin/tally-flow-prune.sh') | sudo crontab -
```

The script is a file because cron reads `%` as a newline and the query contains `strftime('%s')`. Check it: `sudo crontab -l | grep flow`, run it once by hand with `sudo /usr/local/bin/tally-flow-prune.sh` (no output means success), and look at the sizes with the query below an hour later; `flow` should stay under about 1 GB.

To see what is big: `sudo sqlite3 -readonly /var/lib/tally/tally.db "SELECT kind, count(*), round(sum(length(payload))/1048576.0,1) AS mb FROM snapshots GROUP BY kind ORDER BY mb DESC;"`.

A first big cleanup (gigabytes) must be done in chunks of 100 rows, each followed by `PRAGMA wal_checkpoint(TRUNCATE);`: SQLite writes every changed page to the `-wal` file first, so one big DELETE needs as much free disk as it deletes, fails when the disk is full, and leaves a huge `-wal` behind (on 8 Oct it ate 6 GB). If that happens, free a few MB and run `sudo sqlite3 /var/lib/tally/tally.db "PRAGMA wal_checkpoint(TRUNCATE);"` with the workers stopped.

Never delete `tally.db` itself: it also holds Telegram link codes, Guardian settings, Autopilot policies and decisions, and receipts. To shrink the file after a big delete, stop the workers (`./deploy/restart.sh --stop`), run `sudo sqlite3 /var/lib/tally/tally.db "VACUUM;"` (needs free space about the size of the live data), then restart. Never run workers as root or with a temporary data directory: two stray root `collect-registry` workers held 4 GB of `/tmp` copies for three days.

## Adding tokens to the deployed ShareGuard (owner steps, run from your own machine)

Done once for Batch 1 on 8 Oct 2026 (20 tokens: 12 bStock, 8 Ondo; three $6 proofs recorded in `contracts/results/`). The owner key never leaves your machine: forge takes an encrypted keystore account (`OWNER_ACCOUNT`, a name, not a key). Use the archive RPC alias `bsc` (`BSC_RPC`). All commands run in `contracts/` unless noted.

```bash
cd contracts && export PATH="$HOME/.foundry/bin:$PATH"
SHAREGUARD_ADDRESS=0x28F6F19bffbF25E36452c78d12090F0bC922970a
OWNER=$(cast call "$SHAREGUARD_ADDRESS" 'owner()(address)' --rpc-url bsc)
forge script script/AddAssets.s.sol:AddAssets --sig 'preview()' --rpc-url bsc -vv     # keyless, no seeds, nothing signed
```

Batches hold at most 10 manifest entries. Always run the dry run (no `--account`) before the broadcast:

```bash
forge script script/AddAssets.s.sol:AddAssets --sig 'runBatch(uint256,uint256)' 0 10 --rpc-url bsc --sender "$OWNER" -vv
forge script script/AddAssets.s.sol:AddAssets --sig 'runBatch(uint256,uint256)' 0 10 --rpc-url bsc --sender "$OWNER" --account "$OWNER_ACCOUNT" --broadcast -vv
```

A batch that contains Ondo tokens needs fresh seeds, recorded immediately before it (they expire after 2 hours): from the repo root `python3 contracts/tools/gen_buyable.py --seeds-only`. Never run `gen_assets.py` for this: it also rewrites `deploy/assets.json`. Rollback of one token (only `enabled` changes; dry run first, then add `--account "$OWNER_ACCOUNT" --broadcast`): `forge script script/AddAssets.s.sol:AddAssets --sig 'rollback(address)' "$STOCK" --rpc-url bsc --sender "$OWNER" -vv`.

After the batches, from the repo root: `python3 contracts/tools/gen_buyable.py --check` and `python3 contracts/tools/list_enabled.py --snapshot "contracts/captures/depth/batch-1-after-owner-$(date -u +%Y%m%dT%H%M%SZ).json"` (the comparison must report `pass: true`). A new batch needs a new manifest and a new approval; the script refuses any token outside its pinned list.

Live $6 proofs run on the Seoul EC2 with the buyer wallet configured there (`contracts/tools/guarded_buy.py`, `--send` spends real funds); run each token once without `--send` first. The Ondo proof uses the feed value seeded by the owner step, so no signer key is needed.

## Checks after a restart

1. Read the `checking the env` block: a `MISSING` line is a feature that will not work. A warning about `TALLY_FIXTURES`, `TALLY_ALLOW_MISSING_GEO` or `TALLY_DEV_PREVIEWS` means something dev-only is on in production: unset it.
2. Every wanted service must be `running` in the table; a `DEAD` one prints its last log lines.
3. Health from the box itself: `curl -s -H 'cf-ipcountry: KR' http://127.0.0.1:3000/api/health` shows `"binance":"ok"`, a number for `rpcBlock`, `"feedSigner":"configured"` and a sensible `ondoFeed.ageHours`.
4. Live quote: `curl -s -H 'cf-ipcountry: KR' 'http://127.0.0.1:3000/api/quote?ticker=NVDA&usd=6'`.
5. Region gate: `curl -s -o /dev/null -w '%{http_code}\n' -H 'cf-ipcountry: US' http://127.0.0.1:3000/` prints `451`.
6. Through the tunnel on a phone: the landing page loads with a live quote; from a US VPN exit it says "Not available in your region".

## Environment (`/etc/tally/tally.env`, root-only)

Names only here:
- `./deploy/restart.sh` refuses to start (and says which names are missing or look like a wrong spelling) when `BINANCE_W3_API_KEY`, `BINANCE_W3_API_SECRET` or `TALLY_DATA_DIR` is unset, and warns about `BSC_RPC_PRIMARY` and `NEXT_PUBLIC_PRIVY_APP_ID`. The Binance names are `BINANCE_W3_*`, not `BINANCE_WEB3_*` (that spelling once left the web server without credentials on 8 Oct).
- Always: `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` (both public, baked in at build time: load the file before building), `BINANCE_W3_API_KEY`, `BINANCE_W3_API_SECRET`, `BSC_RPC_PRIMARY` (not `BSC_RPC_URL`), `FEED_SIGNER_PK`, `TALLY_DATA_DIR` (same value for the web app and every worker; writable).
- `TALLY_APP_ORIGIN`: the exact browser origin. A quick tunnel changes it on every restart, so update it and restart.
- Guardian and wallet registration: `PRIVY_APP_SECRET` (server only), `TELEGRAM_BOT_TOKEN`.
- Tuning: `TALLY_RATE_LIMIT_MULT`, `TALLY_WORKER_RPS`, `TALLY_MIN_FREE_MB`, `TALLY_EST_MB`, `TALLY_STAGGER_S`.
- Dev-only, must be unset in production: `TALLY_FIXTURES`, `TALLY_ALLOW_MISSING_GEO`, `TALLY_DEV_PREVIEWS`, `TALLY_TEST_WALLET`, `TALLY_TEST_SESSION_WALLET`.
- Hosted MCP: `TALLY_MCP_HTTP_KEY` (optional shared password; clients send `Authorization: Bearer <key>`), `TALLY_MCP_HTTP_PORT`, `TALLY_MCP_HTTP_PLANS` (`0` hides the buy and sell plan tools), `TALLY_MCP_HTTP_RATE_LIMIT` (per client), `TALLY_MCP_HTTP_GLOBAL_LIMIT` (all clients together, default 300 a minute; being added), `TALLY_MCP_HTTP_CONCURRENCY`, `TALLY_MCP_HTTP_ORIGINS`. Generate the key yourself (`openssl rand -hex 32`); never paste it into chat.

## Tunnel and domain

Today: a Cloudflare quick tunnel in a separate terminal or tmux, `cloudflared tunnel --url http://localhost:3000`. It prints `https://<random>.trycloudflare.com`; add that URL under Privy dashboard → Settings → Allowed origins and set `TALLY_APP_ORIGIN` to it. It adds `cf-ipcountry` but not `cf-region-code`. The origin must be reachable only through the tunnel (the rate limiter and the region gate trust Cloudflare's headers); keep the EC2 security group closed to inbound web ports.

Planned: a fixed domain bought before submission, DNS on Cloudflare, a **named tunnel** run as a service so it restarts itself, the app on `app.<domain>` and the MCP on `mcp.<domain>` pointing at `127.0.0.1`. Not set up yet: when it is, write the exact steps here.

## Hosting the MCP over HTTP (WO-05 slice C)

The transport is on `main` (PR #29) but **do not start it yet**: the global request cap (`TALLY_MCP_HTTP_GLOBAL_LIMIT`) that protects the shared Binance key is still being added. Once it has merged: set `TALLY_MCP_HTTP_KEY` (and decide `TALLY_MCP_HTTP_PLANS`), run `./deploy/restart.sh --mcp`, and point the `mcp.<domain>` tunnel route at `127.0.0.1:3300`. It only listens on loopback and refuses the blocked regions.

## On a laptop (development)

Node 22, pnpm 10, git, `cloudflared`; on Windows use WSL.
```bash
git clone https://github.com/deyoungjohn/tally.git && cd tally && pnpm install
echo 'NEXT_PUBLIC_PRIVY_APP_ID=paste-your-app-id-here' > apps/web/.env.local   # public ID, not a secret
TALLY_ALLOW_MISSING_GEO=1 pnpm --filter @tally/web dev                         # http://localhost:3000
```
Localhost has no Cloudflare header, so to test the region gate use a production build behind a quick tunnel and do not set `TALLY_ALLOW_MISSING_GEO`: `pnpm build && PORT=3000 HOSTNAME=127.0.0.1 node apps/web/.next/standalone/apps/web/server.js`, then `cloudflared tunnel --url http://localhost:3000` and open it from a phone or a US VPN exit (should be blocked) and a KR exit (should load). Privy allowed origins must include `http://localhost:3000` and the tunnel URL.

## The phone test

Start the tunnel and add its URL to Privy's allowed origins. The tester opens `/trade/NVDA`, signs in with their email and ticks the declaration. You send about 12 USDT and 0.002 BNB on BNB Smart Chain (BEP-20) to the address shown. They approve once, confirm and see the receipt in shares with the BscScan link. Note where they hesitated.

## `baw` on the EC2 and live tests

`baw` (Binance Agentic Wallet) may run on the EC2 only under the conditions in `docs/work-orders/WO-08-autopilot.md` (you sign in; the session is checked before every attempt; fixed subcommands only; a dedicated unix user). Nothing runs it today. `live-buy-test.sh`, `live-sell-test.sh` and `baw-policy-probe.sh` sit untracked in the WSL clone and move real money or read your wallet: you run them, an agent never does, and each waits for your typed confirmation.

## HTTP MCP settings

These settings control the HTTP MCP server:

| Variable | Simple meaning | Default |
|---|---|---|
| `TALLY_MCP_HTTP` | Set to `1` to enable HTTP. The start command must also include `--http`. | Off |
| `TALLY_MCP_HTTP_PORT` | The local port it listens on. It always binds to `127.0.0.1`. | `3300` |
| `TALLY_MCP_HTTP_PLANS` | Set to `0` to disable building buy/sell transaction plans. Plans are always unsigned. | Plans allowed |
| `TALLY_MCP_HTTP_RATE_LIMIT` | Maximum requests from each client IP per minute. | `60` |
| `TALLY_MCP_HTTP_CONCURRENCY` | Maximum requests being handled at once. | `8` |
| `TALLY_MCP_HTTP_ORIGINS` | Comma-separated website origins allowed to make requests. Agent clients without an Origin header are allowed. | Reject supplied origins |
| `TALLY_MCP_HTTP_KEY` | Optional shared password. Clients must supply it using Bearer authentication. | No password required |

A production setup allowing read tools only could use:

```bash
TALLY_MCP_HTTP=1
TALLY_MCP_HTTP_PORT=3300
TALLY_MCP_HTTP_PLANS=0
```

`TALLY_FIXTURES` separately controls recorded versus live data. None of these settings permits signing or sending transactions. Restart MCP after changing them.
