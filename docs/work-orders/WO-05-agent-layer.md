# WO-05 Agent layer: MCP server, Wallet Skill, upstream PR

| | |
|---|---|
| Agent | B (Codex #1), after WO-04 and before WO-09. Backup: E (OpenCode) |
| Branch | `mod/WO-05-agent-layer` |
| Priority | High: this is what the **$2k Agentic Wallet / Wallet Skills special prize** judges ("deepest, most credible use of the AI execution layer"). It restores blueprint M5, which the module plan had left without an owner. |
| Read first | Blueprint §12 (Agent layer) and M5 row of §17, `MODULES.md` §1–§3, `IDEAS.md` F4, F6, F10, F11, `contracts/README.md`, Binance Agentic Wallet docs (skills reference, tokenized-securities use case), `binance/binance-skills-hub` repo |

## Owns

- `packages/mcp/**` **except** `packages/mcp/src/tools/get-receipt.ts` (WO-02) and `packages/mcp/src/tools/sell.ts`, `packages/mcp/src/tools/switch.ts` (WO-07)
- `skills/share-true-trading/**` (moved here from WO-08)
- `docs/upstream/**` (the upstream PR draft)
- Approved dependency: `@modelcontextprotocol/sdk` in `packages/mcp/package.json` and `pnpm-lock.yaml`
- Approved 2026-10-04, **additive only**: a new read function for holdings in shares in a new file `packages/engine/src/shares.ts` (+ `shares.test.ts`) and one accessor line in `packages/engine/src/engine.ts` (e.g. `engine.sharesOf(address, tickers?)`). It reads `balanceOf` through the existing trade chain and the resolved multiplier from `inspectTicker`/`facts`, in **bigint** 1e18 shares, and returns `shares: null` + a reason for any token whose multiplier is unknown (never skipped, never 1:1, no floats). It must not change `portfolioFor`, `PortfolioReport` or `engine.portfolio` (the web Portfolio still uses them).
- **Not approved / unchanged:** `packages/engine/src/trade.ts` (`prepareTrade`), ShareGuard, `packages/chain` calldata builders, flags (`packages/config/src/flags.ts`). The MCP server is an opt-in stdio process, so it has no `FEATURE_*` flag.

## Tasks

1. **MCP server** (`packages/mcp`, stdio transport, thin shell over `@tally/engine` only; no new engine wiring):
   - `get_consolidated_quote(ticker, usd | shares)` → every issuer's price per share, premium vs US reference, fee, route in plain words, integrity grade + reasons, `best` flag. Same numbers as the web app.
   - `get_shares_of(address)` → holdings in **shares** per ticker across issuers (multiplier + source per row; `null` + reason when a multiplier is unknown, never 1:1).
   - `get_integrity(ticker?)` → grades and reasons (Trap Shield facts), including ghost and paused flags.
   - `build_guarded_swap(ticker, issuer, usdtAmount, tolerancePct?, minShares?, recipient)` → **unsigned** calldata for the deployed ShareGuard (`0x28F6F19bffbF25E36452c78d12090F0bC922970a`), approval target and exact amount, gas limit exactly as the web plan computes it (RPC estimate from the user's address × 1.25, simulated at that limit; never the API's 450000), the share floor, and the facts the user must see. It never signs or sends.
     Contract (decided 2026-10-04): wrap `engine.trade.prepare` unchanged. `recipient` must equal the signing wallet (the plan sets `recipient = user`); any other value → a plain error. `minShares` is an **at-least** constraint: derive the tolerance (0.1–5 %) that meets it from the current quote, call `prepare`, and if the plan's floor is still below the requested `minShares`, return `floor_not_achievable` (state the exact floor the plan used). Build the engine for the MCP **without a feed signer**: pass an env with `FEED_SIGNER_PK` removed and never read it; test that an Ondo buy needing a signed update maps to the plain "share data is being refreshed / use the web app" message instead of signing. `needs_funds` / `needs_approval` statuses are returned as-is (exact-amount approval first).
   - Registers the tools already owned by WO-02 and WO-07 when their files exist (dynamic import, so this PR doesn't touch their files).
   - Fixture mode (`TALLY_FIXTURES=1`) for every tool; errors map to plain messages (40375 minimum, 40304 region, paused, ghost).
2. **Wallet Skill** `skills/share-true-trading/SKILL.md` (+ any helper scripts), per blueprint §12:
   resolve ticker via Tally → choose issuer by effective cost per share → convert shares ↔ USDT, enforce the 6 USDT minimum → build ShareGuard calldata (via the MCP tool or CLI) → show the parsed transaction, risks and share floor → execute only after explicit user confirmation via `baw contract-call` → parse the receipt (shares received, USD per share, premium). Include the multiplier source-of-truth rules (bStock on-chain `uiMultiplier`, Ondo accepted baseline/feed, xStocks display-only) and the gas caveat.
3. **Upstream PR draft** in `docs/upstream/binance-tokenized-securities-info.md`: the exact proposed changes to the `binance-tokenized-securities-info` skill in `binance/binance-skills-hub` (all three issuers, not just Ondo; multiplier source rules; gas estimate caveat; minimum order $5 → enforce $6), with evidence links into `IDEAS.md`. The **user** opens the PR from their GitHub account; you prepare the text and the patch.
4. **Setup snippets** in `packages/mcp/README.md`: how to add the server to Claude Code / Cursor and to BNB Agent Studio (MCP auto-registration). Agent Studio registration is optional (testnet credits), but document it: it is tied to the other $2k special prize.

## Exit checks

- [ ] Unit tests per tool in fixture mode, including: Ondo 10-shares-per-token token converted correctly vs bStock 1:1; unknown multiplier → `null` + reason; `build_guarded_swap` output decodes to the deployed ShareGuard's `swapForShares` with the requested floor and an allow-listed router.
- [ ] `build_guarded_swap` never contains a signature or sends anything (test asserts no signer/transport is used).
- [ ] Error mapping tests (40375, 40304, paused, ghost).
- [ ] `sharesOf` tests: bigint maths, Ondo 10× vs bStock 1×, unknown multiplier → `null` + reason (never skipped), balances read through the existing trade chain only.
- [ ] **User-run (blueprint M5 exit):** Claude Code (or any MCP client) with the Wallet Skill executes a **$6 buy through ShareGuard** via `baw`; tx hash in the PR. Write the exact steps.
- [ ] Upstream PR text ready for the user to submit.

## Out of scope

Autopilot decisions (WO-08), sell/switch tool logic (WO-07), receipts tool (WO-02).

## Slice C (optional, added 2026-10-06): remote HTTP transport, Thursday only

Only if slices A and B are merged and the UI is on track; otherwise skip and say so in the PR. Goal: let a remote agent call the **read-only and unsigned-plan tools** over HTTP, so Tally can be listed as an agent service (see `docs/for-agents.md`). Owns `packages/mcp/src/http.ts` and its tests, plus a short section in `packages/mcp/README.md`. Approved additive edit to `packages/mcp/src/index.ts` for a `--http` switch.

- Use the MCP SDK's Streamable HTTP server transport. If the installed SDK version lacks it, stop and ask; do not add or upgrade dependencies without approval.
- **Off by default.** Starts only with `TALLY_MCP_HTTP=1`; binds `127.0.0.1` only (the chief engineer decides about exposure, for example through the tunnel). No TLS, no domain logic in the package.
- Same tools as stdio, same registry. Tools that build plans (`build_guarded_swap`, `build_sell_swap`) stay behind their existing flags and may additionally be switched off for HTTP with `TALLY_MCP_HTTP_PLANS=0`. The server must never sign or send; the existing test that asserts no signer or transport is used must also cover the HTTP path.
- Per-client rate limit (by `cf-connecting-ip`, as the web app does), request size limit, per-call timeout, and a rejected `Origin` unless it is on an allow-list in env. Mirror the error mapping and the `fixtures` flag: a fixture-mode server must say so in every result.
- **Region gate:** the endpoint must refuse the same restricted regions as the web app, with a 451, using `cf-ipcountry` and the block list in `@tally/config`; it fails closed when the header is missing (`TALLY_ALLOW_MISSING_GEO=1` only for local tests). Hosting plan (chief engineer): a Cloudflare tunnel on a fixed domain, for example `mcp.<domain>`, pointing at `127.0.0.1`; the origin must be reachable only through the tunnel (the rate limiter trusts `cf-connecting-ip`). Cloudflare settings and DNS are the chief engineer's.
- No payments, no authentication scheme beyond an optional shared key from env, no new storage.
- Tests: tool list and a quote call over HTTP in fixture mode; plans disabled when the switch is off; rate limit trips; oversized body rejected; wrong `Origin` rejected; stdio still works unchanged.
- User-run (commands in the PR): start with `TALLY_FIXTURES=1 TALLY_MCP_HTTP=1`, list tools and call `get_consolidated_quote` with `curl` against localhost.

Slice C full instructions: `docs/prompts/wo05-http-transport.md` (use `node:http` and the SDK's `StreamableHTTPServerTransport`, no Express; stateless; region gate; shared-key option). Approved 2026-10-07: the agent continues on `mod/WO-05-agent-layer` (fast-forward it to main), no new branch.
