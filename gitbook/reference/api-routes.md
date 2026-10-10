# Public API routes

The web app's route handlers under `/api`. They are the app's own interface, not a stable public API, and they change with the product. All are validated with zod and rate limited per IP. A request must pass the region gate first (a blocked region gets HTTP 451).

## Public data (no sign-in)

| Route | Purpose |
|---|---|
| `GET /api/quote?ticker=&usd=` (or `shares=`) | Consolidated quote across issuers, cached 10 seconds. |
| `GET /api/radar` | Live integrity grades for the supported tickers (cached). |
| `GET /api/portfolio?address=` | A wallet's holdings in shares across issuers. Any address. |
| `GET /api/holdings?address=` | Every registry token a wallet holds. |
| `GET /api/health` | Binance status, RPC height, the guard's pause state and the Ondo feed's age. `503` when something is unhealthy, with the reason (URLs removed). |
| `GET /api/modules/health` | Per-module worker health and feature flags. |
| `GET /api/vm/portfolio`, `/statement`, `/activity`, `/radar`, `/quality` | Module view models built from snapshots. `404` when the module's flag is off. |
| `GET /api/fills`, `GET /api/transfers` | Recent guarded fills and transfer records. |

## Trade planning (read-only; the wallet signs)

| Route | Purpose |
|---|---|
| `POST /api/trade/plan` | The two-phase buy plan: `needs_funds`, `needs_approval` or `ready`. |
| `POST /api/trade/sell` | The sell plan (behind the sell flag). |
| `GET /api/trade/receipt` | Decode a guarded buy from the chain. |
| `GET /api/trade/tx-status?hash=` | Mined status, block and gas for any transaction. |
| `GET /api/trade/sale-proceeds?hash=` | What a sale paid, read from the chain (behind the Migrate flag). |

## Receipts

| Route | Purpose |
|---|---|
| `POST /api/receipts` | The browser's hint after sending a transaction. Same-origin only. |
| `GET /api/receipts?hash=` | The worker-verified outcome of a sale. |

## Signed-in routes (`/api/session/*`)

These take a Privy access token and a wallet header. The server verifies the token and takes the wallet from Privy's own record for that user.

| Route | Purpose |
|---|---|
| `POST /api/session/active-wallet` | Register the wallet for statement collection. |
| `/api/session/guardian/link-code`, `/feed`, `/settings` | Telegram link code, the alert feed, and settings (read and write). |
| `/api/session/autopilot/policy` | Policy (shadow mode). |

## Other

| Route | Purpose |
|---|---|
| `POST /api/declaration` | Records the region declaration (country and region headers; no IP address). |
