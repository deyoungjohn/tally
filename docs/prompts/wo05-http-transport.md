# WO-05 slice C: HTTP transport for the MCP server (prompt for Agent 05, 2026-10-07)

You are Agent 05 (Codex #1). Keep working in your existing worktree on your existing branch `mod/WO-05-agent-layer` (its tip is already merged into main, so it is only behind). Do **not** create a new branch. Run `git fetch origin && git merge --ff-only origin/main` first and confirm `git status` is clean. Read `AGENTS.md`, `CLAUDE.md`, `docs/work-orders/WO-05-agent-layer.md` (slice C), `docs/for-agents.md`, `packages/mcp/README.md`, `packages/mcp/src/{index,server,runtime,registry,tools,optional}.ts` and `packages/config/src/blocked-regions.ts`. You never push to main, merge, deploy, expose a port, or run anything live. Never create, request, print or store keys, seed phrases, RPC URLs or any secret.

Goal: let a remote agent call Tally's tools over HTTP so the chief engineer can host them behind a Cloudflare tunnel on a fixed domain (for example `mcp.<domain>` to `127.0.0.1`). Tools stay read-only or unsigned: **nothing ever signs or sends**.

## Owns (additive)
`packages/mcp/src/http.ts`, `packages/mcp/src/http.test.ts`, a small `--http` switch in `packages/mcp/src/index.ts`, and the "Hosting" section of `packages/mcp/README.md`. No new dependency: use the MCP SDK's `StreamableHTTPServerTransport` (the installed SDK is 1.32, which has `server/streamableHttp.js`) on Node's own `node:http` server, **not Express**. If anything needs a dependency, stop and ask.

## Behaviour
- **Off by default.** Starts only with `TALLY_MCP_HTTP=1` (and `--http`), listening on `127.0.0.1` and a configurable `TALLY_MCP_HTTP_PORT` (default 3300). Never `0.0.0.0`. Stateless: a fresh server and transport per request, so there is no shared session state to leak.
- **Same tools as stdio**, same registry and error mapping. Plan-building tools (`build_guarded_swap`, `build_sell_swap`) stay behind their existing flags and can be switched off for HTTP with `TALLY_MCP_HTTP_PLANS=0`. Every result carries the existing `fixtures` flag; a fixtures server must say so in every result, never "live".
- **Region gate**, same as the web app: `evaluateRegion({ country: cf-ipcountry, regionCode: cf-region-code }, { allowMissingHeader: TALLY_ALLOW_MISSING_GEO === "1" })` from `@tally/config`; blocked or missing header answers `451` with no tool access. Fail closed.
- **Abuse limits**, per `cf-connecting-ip` (fall back to the socket address only when `TALLY_ALLOW_MISSING_GEO=1`): rate limit (default 60 requests per minute, configurable), request body cap (64 KiB), per-call timeout (15 s), a bounded number of concurrent calls, and `Origin` rejected unless it is on an allow-list in `TALLY_MCP_HTTP_ORIGINS` (a missing `Origin` from a non-browser client is allowed). Optional shared key: if `TALLY_MCP_HTTP_KEY` is set, require `Authorization: Bearer <key>` with a constant-time compare; never log it.
- **No leakage:** errors are the plain mapped messages only (no stack, path, env, RPC URL or secret), logs contain method, tool name and status but never arguments that include a wallet address beyond its first 6 characters, and the server never reads `FEED_SIGNER_PK` (reuse `unsignedEnv`).
- Only `POST /mcp` and `GET /healthz` (returns `{ ok: true, fixtures }`); everything else 404; wrong method 405.

## Tests (fixture mode, no network beyond localhost)
Tools list and a `get_consolidated_quote` call over HTTP; a plan tool is refused when `TALLY_MCP_HTTP_PLANS=0`; blocked country returns 451; missing country header returns 451 unless the override is set; rate limit trips and recovers; oversized body rejected; per-call timeout returns a plain error; wrong `Origin` rejected; wrong or missing key rejected when a key is set; the `fixtures` flag appears in results; **a test that proves no signer, transport or send capability is reachable through the HTTP path**, extending the existing stdio test; stdio still starts and works unchanged; the server binds only `127.0.0.1`.

## Done means
`pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` green, `FULL=1 bash scripts/review-pack.sh mod/WO-05-agent-layer` green, the PR lists every changed file, and the README "Hosting" section gives the user-run commands: start with `TALLY_FIXTURES=1 TALLY_ALLOW_MISSING_GEO=1 TALLY_MCP_HTTP=1`, then `curl` the tool list and one quote against localhost, plus the exact environment variables for production. The tunnel, DNS and exposure are the chief engineer's. If anything is ambiguous, stop and ask; don't guess.

## Follow-up from the review (2026-10-07): global request cap, then it is ready to merge
Add the one change from review finding 1, on the same branch:
- A **global** limit across all clients, `TALLY_MCP_HTTP_GLOBAL_LIMIT` (default 300 requests per minute, integer 1 to 100000, validated like the other settings). When it is exceeded answer `503` with `Retry-After` and the plain `busy`-style error, before any engine work. Keep the per-client limit; both apply. The count must not grow without bound and must reset each minute.
- Tests: the global cap trips with many distinct client IPs each under their own limit; `Retry-After` is present; it recovers after a minute; invalid values are rejected at startup; `/healthz` is not counted against the cap.
- In `packages/mcp/README.md` list the new variable, and for the hosting steps link to `docs/deployment.md` instead of repeating them. Do not edit `docs/deployment.md` (the orchestrator maintains it).
- Rerun `FULL=1 bash scripts/review-pack.sh mod/WO-05-agent-layer`, push, and report. Nothing else changes.
