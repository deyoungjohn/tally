# WO-06 follow-up: server-side Privy session verification (prompt for Agent 06, 2026-10-06)

You are Agent 06 (agy). Work in your worktree on a fresh branch `mod/WO-06-session` cut from `origin/main` (the orchestrator names this branch; do not create others). Read `AGENTS.md`, `CLAUDE.md`, `docs/work-orders/WO-06-guardian.md` (the "Session verification" section), `apps/web/modules/guardian/view-model.ts` (the invariants above `loadGuardianSettings`) and `apps/worker/src/jobs/statement.ts` (it reads `wallet:active` snapshots). You never push to main, merge, send transactions or run anything live. **Never create, request, print or store keys, seed phrases, RPC URLs or the Privy App Secret.** `PRIVY_APP_SECRET` is already in `/etc/tally/tally.env` on the server; you only read it from `process.env` in server code, you never see its value, and tests never use a real one.

## Goal
Today the app cannot prove, on the server, which wallet a signed-in browser owns. Guardian's alerts and settings and the Telegram link code are per-wallet and private, so `loadAlertFeed` and `loadGuardianSettings` must only ever receive an address the server verified. The same proof lets the app safely register a wallet for the statement worker. Build that, server side only.

## Owns (additive; nothing else)
- `apps/web/lib/server/session.ts` and its tests
- `apps/web/app/api/session/**` (new routes, listed below) and their tests
- `apps/web/package.json` and `pnpm-lock.yaml`: add exactly one dependency, `@privy-io/node` (Privy's official server library; not `@privy-io/server-auth`, which Privy now treats as the older one). Pin the version. Stop and ask if it needs a build script or any other package.

Do **not** touch `components/wallet/**` (the UI agent adds the client side), `modules/**`, packages, worker jobs, `proxy.ts`, or the buy and sell paths.

## The helper `lib/server/session.ts` (server-only, `import "server-only"`)
`createSessionVerifier({ client, appId, now })` and a default `verifiedWallet(req, chosen?)`:
1. Read `Authorization: Bearer <access token>`. Missing or malformed: return `null`.
2. Verify the access token with Privy: `privy.utils().auth().verifyAccessToken({ access_token })`. The returned `appId` must equal `NEXT_PUBLIC_PRIVY_APP_ID`; reject otherwise. An expired or invalid token returns `null`.
3. Get the verified user's **linked wallet addresses from Privy's own user record** (confirm the exact call in the current `@privy-io/node` docs and pin it in a comment; if there is no way to do it without an identity token, stop and ask). The access token carries no wallet, so an address from the request is never trusted by itself.
4. The browser may name which wallet it wants (`chosen`). Return it (lowercased `0x…`, 40 hex) only if it is in the user's linked wallets; with no `chosen` and exactly one linked wallet return that one; otherwise `null`.
5. Fail closed on any error (network, Privy 5xx, timeout 5 s): return `null`, never a default or a fallback address, and log only a short reason code through `console.warn` (never the token, the secret, the user id or an address).
6. Cache a verified user's wallet list for 60 s in a bounded in-memory map (max 500 entries) so a page that makes several calls does one lookup.
7. In tests only (`NODE_ENV !== "production"`), `TALLY_TEST_SESSION_WALLET` may stand in for a verified wallet so e2e can run without Privy; it must be impossible to enable in production (test it).

## Routes (all `export const dynamic = "force-dynamic"`, zod-validated, per-IP rate limits like the other routes, region gate unchanged)
- `GET /api/session/guardian/feed` returns `loadAlertFeed({ walletAddress })` and `GET /api/session/guardian/settings` returns `loadGuardianSettings({ walletAddress })`, both only for `verifiedWallet(req, chosen)` where `chosen` is the `x-tally-wallet` header. **Never read an address from the query string, a cookie or the body.** No verified wallet: 401 with `{ error: "session_required" }`, no data. Only when `flags.guardian` is on; 404 otherwise. `POST /api/session/guardian/link-code` issues a new link code through `loadGuardianSettings({ issueNewLinkCode: true })`, same verification, POST only, rate limited tightly (5 per hour per user).
- `POST /api/session/active-wallet`: with a verified wallet, write one snapshot `{ kind: "wallet:active", key: "bsc", data: { address }, source: "web-session", observedAt: now }` through the SnapshotStore so the statement worker discovers it; skip the write if the same address was already registered in the last 24 hours (read `history("wallet:active", "bsc", 0, 50)`); respond 204. Only when `flags.statement` is on, otherwise 404. Rate limit per IP and per user.

## Tests (all with an injected fake Privy client; no network)
Valid token and linked wallet passes; wrong app id; expired token; token for a different user; chosen wallet not linked; no `chosen` with several linked wallets; missing or malformed header; the Privy client throws or times out (returns `null`, no fallback); cache hit does not call Privy twice; cache is bounded. Route tests: **a spoof test** where the query string, a cookie and the body all carry a victim's address and the response is still only the verified wallet's data (or 401); unverified returns no data; flag off returns 404; link-code rate limit trips; active-wallet writes exactly one snapshot and is idempotent within 24 h; a test that captures `console` output and proves no token, secret or address is logged; the test-session override cannot be switched on when `NODE_ENV=production`.

## Done means
Local checks green (`pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`), `pnpm build` and `pnpm e2e` green, `FULL=1 bash scripts/review-pack.sh mod/WO-06-session` green, and the PR lists every changed file and the pinned Privy call. In the PR, describe the client contract for the UI agent: send `Authorization: Bearer <getAccessToken()>` and `x-tally-wallet: <address>`. If anything is ambiguous (especially the Privy user-lookup call), stop and ask; don't guess.
