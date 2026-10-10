# The web app

`apps/web` is a Next.js 16 app (React, Tailwind CSS v4, motion) built as a standalone server. It holds the UI, the `/api/*` route handlers and the region gate.

## Pages

| Route | What it is |
|---|---|
| `/` | Home: a minimal trade card, then one screen each for Trade, Portfolio and Radar, then the FAQ. |
| `/trade`, `/trade/[ticker]` | The full flow: issuer comparison, review, approval, swap, receipt. Buy and sell, Migrate between issuers, and live fills. |
| `/portfolio` | Holdings in shares across issuers, statement, activity, other assets, suggestions. |
| `/radar` | Integrity grades for every token and the flow panels. |
| `/guardian` | Link Telegram and choose alerts. |
| `/pies` | Basket buying (in progress; the logic and execution hook are built). |
| `/receipt/[txHash]`, `/receipt/migrate/[sell]/[buy]` | Public, shareable receipts. Everything on them is verified from the chain. |

## Region gate

`proxy.ts` (Next 16's name for middleware) runs before every page and API route. Cloudflare adds `cf-ipcountry`; the gate blocks the restricted list and answers directly with an HTTP 451. It **fails closed**: a request with no country header is blocked, so a path that bypasses Cloudflare cannot reach the app. Behind a tunnel the request URL is `https://localhost:3000`, so the gate answers itself instead of rewriting; a rewrite there failed with `EPROTO`, and a regression test now covers it.

## Wallets

* **Privy** provides email and Google sign-in with an embedded wallet on BNB Smart Chain. External wallets connect through Privy too. The Privy App ID is public; the App Secret exists only on the server.
* **The wallet bridge** keeps Privy's functions in refs. Putting them in a React dependency list made the app re-render forever (React error #185).
* **Which wallet is active:** an external wallet is used only if the user connected it on purpose in the current signed-in session. A leftover connection from an earlier sign-in is never picked. Logging out disconnects external wallets and clears every cache keyed by address.
* **Before signing, the page reads the wallet's real chain** (`eth_chainId`) and switches to BNB Smart Chain. A cached chain is never trusted.

## Verified sessions

Routes under `/api/session/*` (Guardian settings, link codes, Autopilot policy, active-wallet registration) take a Privy access token. The server verifies it with `@privy-io/node` and takes the wallet **from Privy's own user record**, never from the request. A wallet the user has not linked is refused. Public chain reads, such as a portfolio for any address, need no sign-in.

## View models

Each module exposes a typed view model through `/api/vm/*`: loading, empty (with the reason), stale, degraded, normal. The UI renders states; it does not compute them. Components never read a view model's internals directly.

## Rate limits and caching

Route handlers are validated with zod and rate limited per IP. Quotes are cached for 10 seconds in the engine; live readings in the UI roll digit by digit and refresh only while the tab is visible. A timed refresh never aborts a request that is still running: an endpoint slower than its refresh interval once left a page loading forever.

## Fixture mode

`TALLY_FIXTURES=1` runs the whole app offline against recorded quotes and a fake chain. A browser test hook installs a mock wallet that returns pseudo transaction hashes only the fixture server understands. Fixture mode labels its data as recorded and cannot move money.
