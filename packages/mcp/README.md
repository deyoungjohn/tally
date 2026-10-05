# Tally MCP (WO-05)

Opt-in stdio server over `@tally/engine`. Quotes match the web engine; the holdings accessor is additive bigint math and does not change the web Portfolio. No feature flag, HTTP listener, signer, broadcast client or scheduler. `FEED_SIGNER_PK` is excluded **before its value is read**; stale Ondo feed plans stop and direct the user to the web app. Only the deployed ShareGuard is accepted.

## Run and inspect offline

Node 22 and pnpm 10, from the repository root:

```bash
pnpm install --frozen-lockfile
TALLY_FIXTURES=1 pnpm --silent --filter @tally/mcp start
```

The process waits for MCP messages; stdout contains only protocol output. Warnings go to stderr. Fixture tools replay Seoul recordings as of **2026-10-02 05:26 UTC** with an in-memory wallet/chain. They never fetch the network. All results say `fixtures: true`; do not send their calldata to a wallet. Freshness is measured against the replay clock, not today's wall clock. Available recorded quote amounts: **6, 25, 100, 1000 USDT** for NVDA, AAPL and NFLX. Other fixture requests return an explicit unavailable error. Share-mode requests whose two quote amounts are recorded also work (e.g. NVDA 0.01 shares, clamped to the 6 USDT minimum).

One-shot CLI, JSON stdin and JSON stdout:

```bash
TALLY_FIXTURES=1 pnpm --silent --filter @tally/mcp call get_consolidated_quote <<'JSON'
{"ticker":"NVDA","usd":6}
JSON
TALLY_FIXTURES=1 pnpm --silent --filter @tally/mcp call get_shares_of <<'JSON'
{"address":"0x1111111111111111111111111111111111111111","tickers":["NVDA","NFLX"]}
JSON
TALLY_FIXTURES=1 pnpm --silent --filter @tally/mcp call get_integrity <<'JSON'
{"ticker":"NFLX"}
JSON
TALLY_FIXTURES=1 pnpm --silent --filter @tally/mcp call build_guarded_swap <<'JSON'
{"ticker":"NVDA","issuer":"bstock","usdtAmount":6,"wallet":"0x1111111111111111111111111111111111111111","tolerancePct":1}
JSON
```

The default fixture wallet needs approval, so the last command returns `needs_approval`; the tests inject an approved fixture wallet to prove ready calldata. The server does not pretend an approval happened.

## Tool contract

| Tool | Arguments | Result |
| --- | --- | --- |
| `get_consolidated_quote` | `ticker`, exactly one of numeric `usd` / `shares` | Every issuer, engine's price/premium/fee/route/integrity and `best`; missing values are null; bigint fields serialize as decimal integer strings. |
| `get_shares_of` | `address`, optional `tickers` (1–100) | Every registry token in the requested scope, zero balances included; `balance` in token decimals, `multiplier` and `shares` in bigint 1e18 units; `sharesDisplay`, source, degraded indicator and missing-data reasons. |
| `get_integrity` | optional `ticker` | Same radar grades/reasons as web; explicit `ghost`, `paused`, failed tickers and freshness. |
| `build_guarded_swap` | `ticker`, `issuer`, numeric `usdtAmount`, `wallet`, optional `recipient`, **either** string `minShares` / numeric `tolerancePct` | Unchanged web `TradePlan` status/approval/shortfall/transaction, plus exact approval target/amount, share floor and review facts. No signing/sending. |

Holdings and untargeted integrity default to **NVDA, AAPL, TSLA, QQQ, SPY, NFLX**, matching the web picker. This is explicitly scoped coverage, not a claim to enumerate every asset in a wallet. Supply more tickers to `get_shares_of` or query integrity by ticker. The existing engine registry cannot enumerate its entire public universe through the exported interface; its authenticated collector list is truncated (IDEAS F10), so it is not used to silently choose wallet coverage.

`minShares` is human shares with up to 18 decimals and means **at least** that value. Tolerance is percent, 0.1–5 (default 1). Integer basis-point derivation rounds toward a stronger floor, and the fresh plan is checked again. `floor_not_achievable` means the plan could not meet the request; no calldata is returned. Recipient must equal `wallet`. Rebuild after approval and expiry. The gas fields come unchanged from the web plan: RPC estimate from that wallet, rounded up ×1.25, simulated at that limit. Never use API gas `450000`.

Read tools retain stale results with `ageMs`, `stale` and a reason; expired trade plans fail. Holdings `asOf` is report assembly time, not a new observation time for every cached underlying fact. Quotes/radar use their engine report timestamps. Unknown status/volume makes the corresponding `paused`/`ghost` field null, with the engine's missing-fact reasons. Primary failures return plain MCP `isError` or explicit failed/null rows. Fallbacks warn. Error kinds include `below_minimum` (40375), `region_block` (40304), `paused`, `ghost`, `share_data_refreshing`, `invalid_recipient`, `floor_not_achievable` and `expired`. Diagnostic output omits source URLs, while retaining public BscScan transaction links.

## Claude Code and Cursor

Claude Code supports [stdio MCP registration](https://code.claude.com/docs/en/mcp). Substitute an absolute repo path:

```bash
claude mcp add --transport stdio --scope local --env TALLY_FIXTURES=1 tally -- pnpm --dir /absolute/path/tally --silent --filter @tally/mcp start
```

In Cursor, add this to your [MCP configuration](https://cursor.com/docs/context/mcp) (project `.cursor/mcp.json` or user configuration):

```json
{
  "mcpServers": {
    "tally": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/tally", "--silent", "--filter", "@tally/mcp", "start"],
      "env": { "TALLY_FIXTURES": "1" }
    }
  }
}
```

Install/copy `skills/share-true-trading` into your client's skill directory, preserving the skill body and its runbook reference (or change that reference to the absolute repository path). For example, copy it to `.claude/skills/share-true-trading` and update its relative runbook link. Do not add these client-specific files to this PR. Confirm the client sees four tools. Restart/reload after configuration changes.

Live clients must run in an allowed region, with the existing server environment inherited from its protected env file. Remove `TALLY_FIXTURES=1`; never paste API credentials or credential-bearing RPC URLs into MCP config or chat. For a remote Seoul host, stdio over SSH is sufficient: launch the same command in a user-managed shell that already loads the protected environment. No new public HTTP MCP endpoint is provided.

If you see “Data-provider credentials are not set in this environment,” export `BINANCE_W3_API_KEY` and `BINANCE_W3_API_SECRET` in the shell that starts the MCP server or CLI, then restart the server or retry the CLI; the repo does not load a `.env` file.

## Optional tools from WO-02 / WO-07

At startup the server dynamically imports `src/tools/get-receipt.ts`, `sell.ts`, `switch.ts` **only if present**. Those files must export `register(registry, engine)`; `registry.add(ToolDefinition, async (args) => result)` installs a tool with the common JSON/error handling. It receives the same signer-free engine. Missing files, bad exports, failed imports and throwing registrations warn through URL-redacted diagnostics and leave the four core tools working; startup continues with the other optional tools. Coordinate that export with those owners; their files and business logic are untouched here.

Until WO-02 installs its MCP tool, `call receipt` delegates to **existing** `engine.trade.receipt`, without reimplementing receipt logic:

```bash
TALLY_FIXTURES=1 pnpm --silent --filter @tally/mcp call receipt <<'JSON'
{"ticker":"NVDA","txHash":"0x00000000000000000000000000000000000000000000000000000000000000b2"}
JSON
```

## Optional BNB Agent Studio setup

Studio's installer [auto-registers its own MCP server](https://www.bnbchain.org/en/bnb-agent-studio) into compatible clients; it does not auto-register arbitrary third-party stdio servers. Add Tally separately using the Claude/Cursor snippet above. This is an optional path for the Agent Studio prize; no Studio deployment or registration is claimed by this PR.

The current [Studio quickstart](https://docs.bnbchain.org/developer-kit/bnbchain-studio/quickstart/) provides:

```bash
npm install --global @bnbagent/studio-cli
bag skills install --target both --scope user
```

Reload the IDE and use `/bnbagent-studio` in a **separate Studio project** to prepare a read-only agent that calls Tally's tools. Start with fixture data. Studio's own MCP tools are read-only; BSC testnet trial/credits are optional and do not permit a Tally mainnet buy or turn ShareGuard into a testnet deployment. Review Studio's generated configuration, costs and testnet account requirements with the user. Keep `baw` execution in the manually confirmed Wallet Skill. Hosting a Studio HTTP MCP face is separate work, not implemented here.

## User-run $6 ShareGuard buy (M5 evidence)

Run on the PC in Nigeria or Seoul EC2, with a connected BSC Agentic Wallet holding ≥6 USDT plus BNB for gas. Load existing API/RPC environment through the protected server setup; do not enter credentials in chat. Install Agentic Wallet using its official instructions, enable Developer Mode in the Binance App and load `share-true-trading` into the MCP client. **These commands can spend real money and are for the user only.**

1. Confirm fixture mode is absent and inspect wallet settings/address:

```bash
unset TALLY_FIXTURES
baw wallet settings --json
baw wallet address --json
```

2. Select the address whose `binanceChainId` is `56`. In Claude Code (or another configured MCP client), request: “Use share-true-trading to compare NVDA for 6 USDT and prepare the cheapest issuer through Tally. Show the exact share floor, approval, route, gas and risks. Do not execute until I confirm the successful preview.” Set `wallet` and `recipient` to that BSC address. If the winning Ondo issuer needs a feed update, use the web app or explicitly choose bStock; never silently change issuer. The offline snippets above become live by removing `TALLY_FIXTURES=1`.

3. On `needs_approval`, preview the plan's USDT approval:

```bash
baw contract-call preview --binanceChainId 56 --from <wallet> --to <plan.approve.to> --value 0 --inputData <plan.approve.data> --json
```

Show the parsed approval, risks and authority changes. Check spender = deployed ShareGuard and amount = **6000000000000000000**. After the user explicitly confirms that approval, execute only its request ID:

```bash
baw contract-call execute --requestId <approval-preview-requestId> --json
```

Wait for on-chain confirmation (complete any pending Binance App confirmation). Then call `build_guarded_swap` again with the same 6 USDT intent. It must now be `ready`.

4. Check `baw contract-call preview --help` for `--gasLimit` first, and record the result in this PR. Show the ready plan. Whenever help lists the flag, pass the plan's exact gas limit so the preview and sent transaction use the limit Tally simulated:

```bash
baw contract-call preview --help
baw contract-call preview --binanceChainId 56 --from <wallet> --to 0x28F6F19bffbF25E36452c78d12090F0bC922970a --value 0 --inputData <plan.tx.data> --gasLimit <plan.tx.gasLimit> --json
```

If help does not list `--gasLimit`, omit it and state in the facts shown that the sent limit is baw's own and may differ from Tally's simulation. Record the actual approval/swap preview and execute command lines used in this PR. Inspect parsed transaction, simulation, risks and authority changes alongside decoded plan fields and share floor. Rebuild if the plan is older than about **90 seconds**; the on-chain deadline is **300 seconds** and the share floor protects the price. The engine's 15-second quote freshness check applies when creating the plan, not to this review window. Check the actual calldata deadline. After explicit buy confirmation, with a plan no older than about 90 seconds and its deadline still ahead:

```bash
baw contract-call execute --requestId <swap-preview-requestId> --json
```

If the plan becomes older than about 90 seconds or its deadline passes during review, rebuild, preview and obtain confirmation again. Do not execute the old request. Save the returned hash before polling; for pending App approval track the same order, never submit another.

5. Verify the receipt through the MCP receipt tool if installed, or:

```bash
pnpm --silent --filter @tally/mcp call receipt <<'JSON'
{"ticker":"NVDA","txHash":"<confirmed-swap-hash>"}
JSON
```

Record the real hash/BscScan link, issuer, requested/actual floor, gas limit, preview facts and the returned `Guarded` shares, amount, USD per share and premium in the PR. Check `to` = deployed guard, caller/recipient/stock match, status success, `fill.shares ≥ plan.minShares`, and actual USDT input = 6 USDT. No `Guarded` event means unverified; pending means wait; reverted means report the failure and gas. The WO-05 live exit stays **pending** until that evidence is supplied; prior M2 buys do not prove the MCP/baw path.

## Verification

```bash
pnpm --filter @tally/mcp test
pnpm --filter @tally/engine test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

`src/tools.test.ts` covers tools, floor/calldata, approvals, no live transport, signer exclusion, errors, outage/stale data and optional modules; `src/server.test.ts` checks a real stdio MCP client and the unsigned receipt CLI. `packages/engine/src/shares.test.ts` covers recorded NFLX 10× vs 1×, precision, rejected/missing multipliers and balance-source failures.
