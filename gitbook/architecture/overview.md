# Architecture overview

```
 Browser · Telegram · AI agents
              │ HTTPS / Bot API / MCP
      Cloudflare edge  ── cf-ipcountry → region gate
              │ Cloudflare Tunnel (no open inbound ports)
 ┌────────────▼──────────────────────────────────────────────────────┐
 │ AWS Seoul EC2                                                     │
 │  apps/web (Next.js)   apps/bot (grammY)   packages/mcp            │
 │        │                    │                    │                │
 │        └────────────┬───────┴────────────────────┘                │
 │              packages/engine (wiring)                             │
 │        ┌─────────────┼──────────────┐                             │
 │  packages/core   packages/binance  packages/chain                 │
 │  (pure maths)    (signed client)   (viem + failover)              │
 │                                                                   │
 │  apps/worker: collectors and jobs ──► SQLite snapshot store ◄── web reads
 └──────────┬───────────────────────────────┬────────────────────────┘
            │                               │
   Binance Web3 API                  BNB Smart Chain RPC
            │                               │
            └──► ShareGuard ──► LiquidMesh router ──► pools / market makers
```

## Principles

1. **Every Binance API call comes from the Seoul server.** The API refuses callers in some countries for the whole API, not per token or wallet. The API secret never reaches a browser, the bot or an agent.
2. **Users sign everything in their own wallet.** The server builds transactions and never holds keys or funds.
3. **One engine, many surfaces.** `packages/core` is pure TypeScript with no I/O; `packages/engine` wires it to the API client and the chain. The web app, bot and MCP call the engine and never rebuild the wiring, so numbers are identical everywhere.
4. **Workers write, the web reads.** Slow or rate-limited work (registry, prices, trade history, statements, alerts) runs in `apps/worker` and writes snapshots to SQLite. Pages read snapshots and never call Binance on the request path for those modules.
5. **Never trust a number you can verify.** The API's gas figure is a placeholder (always 450,000). Multipliers are read onchain where possible. A receipt's amounts come from the chain's logs, not from the browser.
6. **Never fail silently.** A missing fact carries its reason. Every data-source fallback warns. A module that falls behind says "catching up" and shows its last good data with its age.
7. **Fixture data is never presented as live.** A fixture server labels everything as recorded.

## Request paths

| Path | Flow |
|---|---|
| Quote | Browser → `/api/quote` → engine → Binance quotes (paced) + chain reads → ranked rows. Cached 10 seconds. |
| Buy | Browser → `/api/trade/plan` (two-phase: funds, approval, ready) → wallet signs approval and ShareGuard swap → `/api/trade/receipt` decodes the `Guarded` event. See [The trade plan](trade-plan.md). |
| Radar, Portfolio, Statement | Browser → `/api/vm/*` → view model built from snapshots in SQLite. No network calls on the request path. |
| Receipts | The browser sends a short-lived hint; a worker follows the transaction onchain and records a verified result. |
| Agents | MCP tools call the same engine and return unsigned transactions. |
