# Deploying Tally web to the AWS Seoul EC2 (M0 runbook)

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
sudo git fetch origin claude/inspiring-fermat-u5ryah && sudo git checkout claude/inspiring-fermat-u5ryah
sudo git pull origin claude/inspiring-fermat-u5ryah

sudo pnpm install --frozen-lockfile
set -a; source /etc/tally/tally.env; set +a
export NEXT_PUBLIC_ENABLE_WALLET_CHECK=1        # M0 only: exposes /dev/wallet-check
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

## 4. M0 exit checks to run
1. Open the tunnel URL on a phone: landing skeleton with the tokens.
2. **Region:** from a US VPN exit the page must say "Not available in your region" (HTTP 451); from KR (or any unlisted country) the site loads.
3. Open `<tunnel-url>/dev/wallet-check`, sign in, copy the embedded wallet address, send it a few cents of BNB **on BNB Smart Chain (BEP-20)**, press *Refresh balance*, then *Send 0 BNB to self*. Send the BscScan link.

## Updating later
```bash
cd /opt/tally && sudo git pull && sudo pnpm install --frozen-lockfile
set -a; source /etc/tally/tally.env; set +a; sudo -E pnpm build
sudo chown -R tally:tally /opt/tally && sudo systemctl restart tally-web
```
