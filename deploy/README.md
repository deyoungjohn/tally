# Running and deploying Tally web

## A. Running and checking from your laptop (no server needed)
Needs Node 22, pnpm 10 (`corepack enable`), git, and `cloudflared` (`brew install cloudflared`, or the Cloudflare download page). On Windows use WSL.

```bash
git clone https://github.com/deyoungjohn/tally.git && cd tally
git checkout main
pnpm install

# Public Privy App ID (Privy dashboard > your app > Settings). Not a secret.
cat > apps/web/.env.local <<'ENV'
NEXT_PUBLIC_PRIVY_APP_ID=paste-your-app-id-here
ENV
```

**Run locally** (Privy allowed origins must include `http://localhost:3000`):
```bash
TALLY_ALLOW_MISSING_GEO=1 pnpm --filter @tally/web dev     # http://localhost:3000
```

**Tunnel plus region gate.** Localhost has no Cloudflare header, so use a production build behind a quick tunnel (Cloudflare adds the real `cf-ipcountry`):
```bash
pnpm build                                            # reads apps/web/.env.local
PORT=3000 HOSTNAME=127.0.0.1 node apps/web/.next/standalone/apps/web/server.js   # leave running; do NOT set TALLY_ALLOW_MISSING_GEO
# in a second terminal:
cloudflared tunnel --url http://localhost:3000        # prints https://<random>.trycloudflare.com
```
Add that URL to the Privy allowed origins, then open it from your laptop (NG: should load), and from a phone or laptop behind a US VPN exit (should show "Not available in your region"). Also try a KR exit.

## B. Deploying to the AWS Seoul EC2 (needed before M3, and for judging)

Run these **on the EC2 box** (Ubuntu 24.04, 2 GB RAM + the 4 GB swap file). Secrets live only in `/etc/tally/tally.env`; never commit them and never paste real secret values into chat.

## 0. One-time prerequisites
```bash
# Node 22 and pnpm
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo corepack enable && sudo corepack prepare pnpm@10.28.0 --activate

# service user + dirs
sudo useradd --system --home /opt/tally --shell /usr/sbin/nologin tally || true
sudo mkdir -p /opt/tally /var/lib/tally
sudo chown tally:tally /var/lib/tally

# cloudflared
curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
# (use ...-arm64.deb on a Graviton instance: check with `uname -m`)
sudo dpkg -i /tmp/cloudflared.deb
```
The swap file and `/etc/tally/tally.env` are already done. From M3 the env file holds everything the app needs (see `tally.env.example`): `NEXT_PUBLIC_PRIVY_APP_ID`, the Binance key and secret, `BSC_RPC_PRIMARY` (not `BSC_RPC_URL`), `TALLY_DATA_DIR` and `FEED_SIGNER_PK`. There is no `.env.local` on the server.

> If `systemctl show tally-web -p User` prints `User=` (empty), the installed unit runs as root and the `tally` user does not exist. Then `/var/lib/tally` needs no `chown`, and the `chown tally:tally` lines below can be skipped.

## 1. Get the code and build
`NEXT_PUBLIC_*` values are baked in at build time, so build with the env file loaded.
```bash
sudo git clone https://github.com/deyoungjohn/tally.git /opt/tally   # first time only
cd /opt/tally
sudo git fetch origin main && sudo git checkout main
sudo git pull origin main

sudo pnpm install --frozen-lockfile
set -a; source /etc/tally/tally.env; set +a
sudo -E pnpm build                              # uses swap; takes a few minutes
sudo chown -R tally:tally /opt/tally
```

## 2. Install and start the services
```bash
sudo cp deploy/tally-web.service deploy/tally-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tally-web tally-tunnel
systemctl status tally-web --no-pager
curl -s -H 'cf-ipcountry: KR' http://127.0.0.1:3000/api/health      # expect {"ok":true,...}
curl -s -o /dev/null -w '%{http_code}\n' -H 'cf-ipcountry: US' http://127.0.0.1:3000/   # expect 451
```

## 3. Get the tunnel URL
```bash
journalctl -u tally-tunnel --no-pager | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
```
Send that URL back, and add it (plus `http://localhost:3000`) under **Privy dashboard → your app → Settings → Allowed origins**. The URL changes whenever the tunnel restarts.

> A quick tunnel is a Cloudflare free service and **does add `cf-ipcountry`**. It does *not* give you the dashboard needed to enable the visitor-location transform, so `cf-region-code` (Crimea/Donetsk/Luhansk) only works after the domain is on Cloudflare with a named tunnel. Until then the gate blocks by country only.

## 4. Checks to run after a deploy
1. Open the tunnel URL on a phone: the landing page shows a live NVDA quote, and `/trade/NVDA` shows the comparison.
2. **Region:** from a US VPN exit the page must say "Not available in your region" (HTTP 451); from KR (or any unlisted country) the site loads.
3. **Health** (live data, from the box itself): `curl -s -H 'cf-ipcountry: KR' http://127.0.0.1:3000/api/health`. Expect `"binance":"ok"`, a number for `rpcBlock`, `"feedSigner":"configured"` and an `ondoFeed.ageHours` under 72. `"binance":"region_block"` means the server's region drifted (40304).
4. **Live quote:** `curl -s -H 'cf-ipcountry: KR' 'http://127.0.0.1:3000/api/quote?ticker=NVDA&usd=6'`

## C. The phone test (M3 exit check 1)
1. Start a temporary tunnel and leave it running: `cloudflared tunnel --url http://localhost:3000` (or read the URL of the `tally-tunnel` unit, section B.3). A new URL means a new Privy allowed origin.
2. Add the URL under **Privy dashboard → Settings → Allowed origins**.
3. The tester opens it on their phone, goes to `/trade/NVDA`, taps **Sign in to buy**, ticks the declaration and signs in with their email.
4. The top-up sheet shows their wallet address. You send about 12 USDT and 0.002 BNB **on BNB Smart Chain (BEP-20)** to that address. The page continues by itself when the money arrives.
5. They approve once, confirm, and see the receipt in shares with the BscScan link. Write down where they hesitated.

## Updating later
```bash
cd /opt/tally && sudo git pull && sudo pnpm install --frozen-lockfile
set -a; source /etc/tally/tally.env; set +a; sudo -E pnpm build
sudo chown -R tally:tally /opt/tally && sudo systemctl restart tally-web
```
