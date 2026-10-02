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
The swap file and `/etc/tally/tally.env` are already done. The env file needs `NEXT_PUBLIC_PRIVY_APP_ID`, `NODE_ENV=production`, `PORT=3000` (see `tally.env.example`).

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
1. Open the tunnel URL on a phone: landing skeleton with the tokens.
2. **Region:** from a US VPN exit the page must say "Not available in your region" (HTTP 451); from KR (or any unlisted country) the site loads.

## Updating later
```bash
cd /opt/tally && sudo git pull && sudo pnpm install --frozen-lockfile
set -a; source /etc/tally/tally.env; set +a; sudo -E pnpm build
sudo chown -R tally:tally /opt/tally && sudo systemctl restart tally-web
```
