# V-AW: Binance Agentic Wallet policy evidence

Date: **2026-10-06** (Africa/Lagos). Installed CLI: **`baw 1.10.0`**.

**Recommendation: caps exist but are account-wide only**

Here, “account-wide” means wallet-wide within the isolated Agentic Wallet, **per capability quota pool**, rather than per Tally rule, trade, or delegated session. It does not mean one total cap across every capability or across the user's main Binance wallet.

## Finding and gate decision

**Yes: documented bounded, unattended execution exists on BSC (56).** Binance documents API-enforced daily budgets, session expiry, token scope, action-category controls, and Secure Auto Sign. Developer Mode separately supports external calls with its own daily quota and a direct-broadcast path.

**V-AW passes its documented minimum** (“spend caps or session policy exist on BSC”; `MODULES.md` §5). This is documentation evidence, not a live enforcement test. It does **not** establish all of WO-08's stronger requirements: a wallet-enforced per-trade cap, a per-rule budget, or a directional policy allowing only a particular token's sale to USDT. Do not describe those as proven. Until that narrower policy can be established, the one-tap approval flow remains the conservative option for that exact requirement.

## Scope and collection checks

- First commands were `baw --version`, then `baw --help`.
- Collected root help plus **149** command/nested-command help outputs, including every advertised built-in `help [command]`. Every help invocation exited **0** and printed help; no login prompt or non-help output occurred.
- No non-help wallet query was run: no status, settings, quota, balance, address, preview, connection, or authentication operation. No signing, transaction, settings mutation, installation, or live endpoint experiment was performed.
- No credentials, session files, environment files, configuration directories, keystores, or credential-bearing RPC URLs were opened. No installed implementation/source code was inspected.
- No secret-looking credential value was encountered in the collected help or documentation output; no redaction was required. Token contract addresses, pagination parameter names, and placeholder QR/request IDs in help are public/example information.
- Only this report was created. No branch, commit, push, or PR. The initial worktree already contained the unrelated untracked `apps/web/public/bg-glow.webp:Zone.Identifier`; it was left untouched.
- Skill operational preflights were not run: the user's explicit version/help/docs-only scope overrides the skill's instructions to query connection/settings or initiate sign-in.
- No application checks or builds were needed for this documentation-only task.

## Installation and documentation sources

`which baw` returned:

```text
/home/dell/.nvm/versions/node/v22.23.1/bin/baw
```

`readlink -f` resolved that executable to:

```text
/home/dell/.nvm/versions/node/v22.23.1/lib/node_modules/@binance/agentic-wallet/dist/index.js
```

Only the path was resolved; the JavaScript file was not read. A Markdown-only search of the installed package, excluding dependency directories, found **README.md only**; no shipped Markdown skills directory was found.

Relevant exact lines from [the installed README](/home/dell/.nvm/versions/node/v22.23.1/lib/node_modules/@binance/agentic-wallet/README.md:6):

> - Multi-chain: BSC, Ethereum, Base, Solana and more
> - Set agent boundaries within Binance App

The separately installed [Binance Agentic Wallet skill](/home/dell/.agents/skills/binance-agentic-wallet/SKILL.md:1) identifies skill version **1.12.0** and required CLI version **1.10.0**. Read its wallet settings, external signing, preflight, wallet-view, market-order, limit-order, security, send, and approvals documentation. These are documentation files, not wallet configuration or session files.

Also read the requested repository references: [WO-08](../work-orders/WO-08-autopilot.md), [MODULES.md](../../MODULES.md), [Tally Wallet Skill](../../skills/share-true-trading/SKILL.md), and [MCP runbook](../../packages/mcp/README.md), plus repository instructions. Existing manual-buy documentation still requires explicit approval after preview; it is not an autopilot authorization.

Checked public primary sources on the report date:

- [Binance Developer Docs: Agentic Wallet](https://developers.binance.com/en/docs/products/agentic-wallet/welcome), displayed last modified **2026-10-05**.
- [Binance: Agentic Wallet Controls](https://www.binance.com/en/blog/tech/7276731523787720812), dated **2026-09-11**.
- [Binance Agentic Wallet FAQ](https://www.binance.com/en/support/faq/detail/3ff00e2d488a41c4aaa4aabb6fc36763), search result displayed update **2026-08-26**.
- [Upstream wallet settings reference](https://github.com/binance/binance-skills-hub/blob/main/skills/binance-web3/binance-agentic-wallet/references/wallet-setting.md) and [upstream external-sign reference](https://github.com/binance/binance-skills-hub/blob/main/skills/binance-web3/binance-agentic-wallet/references/external-sign.md).

No third-party Binance Square posts were used as evidence. Public docs and example responses do not reveal the actual settings of the user's wallet.

## Answers a–h

### a. Is there a per-transaction spend cap? Can we set it from the CLI?

**No — no documented independent per-transaction policy cap or CLI setter was found.** This is a conclusion about the complete inspected command surface and docs, not proof that no undisclosed App control exists.

Exact help:

```text
Usage: baw wallet settings [options]

Query agent wallet settings

Options:
  -h, --help  display help for command
```

`market-order swap --help` exposes these operation parameters:

```text
  --fromTokenQty <fromTokenQty>      Amount to swap
  --fromToken <fromToken>            Source token address
  --toToken <toToken>                Destination token address
```

An amount selected by the caller is an instruction for that operation, not a policy preventing a subsequent operation with a larger amount. No command exposes a per-trade budget setter. The [local wallet-setting reference](/home/dell/.agents/skills/binance-agentic-wallet/references/wallet-setting.md:102) states:

> Settings cannot be changed via the CLI.

A daily quota also bounds any single operation's usable remaining budget, but it is not an independent per-transaction cap.

### b. Is there a daily (or periodic) cap, enforced by baw or the account rather than our code?

**Yes — account/API-enforced daily quotas; configured in the Binance App, queryable from CLI.**

Exact `wallet left-quota --help`:

```text
Query daily trading limit usage
```

The [local wallet-setting reference](/home/dell/.agents/skills/binance-agentic-wallet/references/wallet-setting.md:67) defines the daily limit as:

> maximum total transaction value allowed in a 24-hour period.

The [official developer overview](https://developers.binance.com/en/docs/products/agentic-wallet/welcome) states:

> These rules constrain the Agent at the API level.

The local settings reference separately documents the normal transaction quota, prediction quota, DeFi quota, Developer Mode external-sign quota, and x402 quota. These pools are independent. External `contract-call` and `sign-message` consume Developer Mode policy, not a single shared normal-trading budget.

The [official controls article](https://www.binance.com/en/blog/tech/7276731523787720812) states:

> There's no single overall cap

Do not infer a global maximum from only the normal daily limit. Actual values were not queried; example settings are not the user's settings.

### c. Is there a time-boxed or scope-limited session so an agent can act without a prompt each time?

**Yes — time-bounded wallet authorization and conditional automatic signing are documented; no per-task scoped-session policy command is exposed.**

Exact `auth signout --help`:

```text
Sign out from the wallet by clearing the session
```

Help alone does not specify expiry. The [local preflight reference](/home/dell/.agents/skills/binance-agentic-wallet/references/preflight.md:87) states:

> sessions last up to `maxSigninDuration` and also sign out after inactivity.

The settings reference describes maximum sign-in duration, fixed inactivity sign-out, session expiry, and Developer Mode expiry. Session expiry is wallet authorization expiry; a preview's expiry is only the lifetime of a prepared operation. Neither proves a token-pair-specific delegated session. See (f) for the documented no-App-prompt execution path.

No session content was inspected and no authentication flow was run.

### d. Can allowed contracts, tokens or actions be restricted? Can it be limited to selling a given token on BSC to USDT only?

**Unclear for that exact sell-only restriction. Yes for token scope, recipient address-book restrictions, and broad action categories; no documented custom contract/function/directional-pair policy was found.**

Exact `limit-order sell --help`:

```text
  --fromTokenQty <fromTokenQty>      Amount of tokens to sell
  --fromToken <fromToken>            Token to sell (address)
  --toToken <toToken>                Destination token address
```

These select a single order's intent; they do not restrict every future order using the same authorization. Likewise, `contract-call preview --help` accepts caller-selected contract and calldata:

```text
  --to <address>         Contract address to interact with (EVM only, required
                         for EVM)
  --inputData <hex>      EVM calldata, 0x-prefixed hex (EVM only)
```

The [official controls article](https://www.binance.com/en/blog/tech/7276731523787720812) says the token whitelist allows the agent to:

> only operate on tokens you specify.

It also states:

> Disabled scenarios are inaccessible to the agent.

That article describes an App-managed token whitelist, action-category toggles, and compulsory transfer-recipient restrictions. It does not document a directional token-pair rule or a configurable contract/function allow-list for Developer Mode.

**Inference:** allowing the source token and USDT does not, by itself, establish “sell only”; reverse trades or other operations involving those allowed assets may still fit the broader permissions. Transfer-recipient restrictions do not prove equivalent restrictions on arbitrary contract targets. ERC-20 approval management is another control, not a documented Agentic Wallet transaction-policy editor.

### e. Does baw support BSC (chain 56) for these capabilities?

**Yes — BSC is explicitly supported for trading and external contract calls.**

Exact `contract-call preview --help`:

```text
  --binanceChainId <id>  Binance chain ID (e.g. 56 for BSC, 1 for Ethereum,
                         CT_501 for Solana)
```

Market swap, limit buy/sell, transaction-lock and message-signature help also give chain-56 examples. The [official developer overview](https://developers.binance.com/en/docs/products/agentic-wallet/welcome) lists BSC with chain ID 56 as supported. The policy documentation does not confine daily quotas or session expiry to another chain. This does not prove that every token supports every order type; no token-specific execution was attempted.

### f. Is there an unattended mode without human confirmation? What prevents unintended actions?

**Yes — conditional Secure Auto Sign/direct broadcast. The account's configured policy bounds operations, but does not prove our exact intended sell-only behavior.**

Exact `contract-call execute --help`:

```text
Execute a previewed agent wallet contract call

Options:
  --requestId <id>  Preview requestId
  -h, --help        display help for command
```

There is no advertised `--yes`, `--unattended`, or `--skip-confirmation` mode switch. The [local external-sign reference](/home/dell/.agents/skills/binance-agentic-wallet/references/external-sign.md:168) provides the decisive behavior:

> `requireConfirmation=false` means execute can broadcast directly.
>
> `requireConfirmation=true` means execute will create an order that must be approved in the Binance App.

Daily quota, token scope, enabled action categories, session expiry, and risk handling constrain normal actions. External signing has a separate Developer Mode quota and simulation/risk checks. The official controls article also describes a Developer Mode balance ceiling, inactivity expiry, and rejection of unlimited approvals. Those are financial and risk boundaries, not proof of a single allowed strategy. See [Binance Agentic Wallet Controls](https://www.binance.com/en/blog/tech/7276731523787720812).

The skill workflow still instructs the agent to obtain explicit user confirmation after preview. That workflow requirement is separate from whether the backend can technically auto-sign. No standing authorization for a future autopilot or any live action was granted in this inspection.

The limit-order reference describes automatic execution once a specified price is hit. Its fixed input/output/quantity can bound one placed order, but does not prove a general wallet session restricted to that order. No dedicated take-profit, stop-loss, trailing-stop, OCO, or session-policy subcommand appeared in the complete help tree. Trigger-price orders are not evidence that every WO-08 alert condition can be delegated.

### g. Where do keys live: local, custodial, MPC?

**Yes — MPC/keyless is documented. Exact key-share storage locations and custody classification are unclear from the inspected docs.**

CLI help contains no custody or key-storage statement. The installed README describes Binance Wallet Infrastructure, without explaining key placement. The [official FAQ](https://www.binance.com/en/support/faq/detail/3ff00e2d488a41c4aaa4aabb6fc36763) states:

> enterprise-grade MPC key security.

The [official developer overview](https://developers.binance.com/en/docs/products/agentic-wallet/welcome) says a complete private key is not reconstructed on one device or server, and an AI agent cannot directly possess or transfer the keys. This supports MPC; it does not identify where each share lives or justify a more specific custodial/noncustodial claim. No files were inspected to infer that answer.

### h. What happens when a cap is hit: refusal or silent success?

**Yes — refusal is documented for a daily-cap breach; silent execution past the cap is not documented. Exact installed-version error code and status behavior remain untested.**

Help establishes a quota query, but does not specify the failure result. The [local wallet-setting reference](/home/dell/.agents/skills/binance-agentic-wallet/references/wallet-setting.md:109) lists:

> daily limit exceeded

as a reason for transaction rejection under security policy, and lists corresponding prediction, DeFi, Developer Mode, and x402 quota rejections. The [official developer overview](https://developers.binance.com/en/docs/products/agentic-wallet/welcome) explains that out-of-policy actions are rejected or require further confirmation, depending on the rule.

Do not confuse a refusal with order submission or pending App approval. The local market-order reference says an accepted order ID alone is not proof of execution; the external-sign reference distinguishes broadcast from pending confirmation. A successful JSON envelope can represent a pending order rather than an onchain trade. This inspection did not establish whether any cap specifically offers an App override, nor the error/exit code the installed CLI returns at the boundary.

## Other controls and distinctions

- **Gas cap:** `contract-call preview --help` explicitly supports `--gasLimit` with range 21000–15000000. Its exact text says:

```text
--gasLimit is a cap, not a bypass: the transaction is still simulated with that value as the
ceiling and the same value goes on chain verbatim. If the call needs more gas than the cap,
preview fails right here instead of the transaction running out of gas after broadcast.
Supply it on preview only — execute takes just the requestId and reuses the previewed value.
```

  This limits gas units for one prepared transaction. It is not a token-spend, USD, gas-price, or daily policy cap. No preview was run.
- **Slippage and MEV:** swap/order help advertises slippage (`auto` or 0–100) and MEV protection defaulting to true. They are execution controls; neither establishes a permitted-action or aggregate-spend policy.
- **Preview versus execute:** contract calls and message signatures use an operation-specific preview request ID. Help does not authorize execution or guarantee no confirmation. Developer Mode must first be configured in the App.
- **Approvals:** help exposes list/detail/revoke. The `--spender` filter is a query/approval selector; it is not a setter for an Agentic Wallet contract allow-list.
- **Kill switch:** official docs describe sign-out/revocation and App freeze controls. No such control was exercised.
- **Balance ceiling:** a segregated wallet balance further limits available funds; that is distinct from an independently enforced per-rule cap.

## Uncertainties and experiments that would resolve them

These are **proposed user-run checks only**, requiring separate authorization. No wallet operation or setting change is authorized by this report.

1. **Actual policy:** inspect App settings to establish enabled categories, token scope, remaining session time, each independent quota, and Developer Mode status. No actual wallet values were collected. Documentation sample balances, durations, and limits must not be treated as live configuration.
2. **Sell-only scope:** inspect whether the App offers a directional token-pair, contract-address, function-selector, or per-trade/session policy beyond the documented token list and module toggles. If none exists, Tally's own code cannot make that restriction wallet-enforced.
3. **BSC refusal behavior:** in a separately approved controlled test, establish the error code, exit code, and order status at/above the applicable cap; prove no broadcast occurs when rejected. This may involve state changes or spending and was deliberately not attempted.
4. **External-call accounting:** establish how BSC ERC-20 calldata, finite approvals, permits/message signatures, swaps and multi-action calls are valued against Developer Mode quota, and whether token/recipient restrictions apply identically in that mode.
5. **Quota semantics:** establish rolling versus calendar-day reset, timezone, gas/fees inclusion, in-flight reservation, concurrent requests, later limit-order fills, and failed transactions. Docs say 24-hour limits and show date fields but do not settle all those accounting details.
6. **Session and expiry:** establish exact live duration, renewal requirements, and behavior of already-placed limit orders after sign-out, freeze, or session expiry.
7. **Target-asset order support:** establish whether the specific Tally stock token supports the intended order/trigger. General BSC support is not token-specific capability evidence.
8. **Documentation versions:** local skill 1.12.0 requires CLI 1.10.0; upstream documentation can change. Local wallet-view examples name additional chains while the public overview lists four; BSC 56 is consistent. No upgrade or live chain query was run.
9. **Key-share placement:** inspected documentation establishes MPC only; it does not specify share storage locations or enough information for a custody classification.

## Complete command tree

Generated from the exact advertised `Commands:` sections. Built-in `help [command]` is listed once per command group and was inspected with `--help`; its arbitrary argument is a help target, not another wallet subcommand.

```text
baw
  skill-check
  cli-check
  auth
    signin
    signout
    verify
    help [command]
  wallet
    status
    address
    balance
    send
    cancel
    speed-up
    tx-history
    settings
    left-quota
    tx-lock
    chains
    gas-price
    help [command]
  market-order
    swap
    quote
    list
    help [command]
  limit-order
    buy
    sell
    list
    cancel
    help [command]
  x402-payment
    preview
    sign
    help [command]
  prediction
    market
      list
      detail
      search
      order-book
      last-trade-price
      help [command]
    category
      list
      help [command]
    position
      list
      token
      settled-history
      pnl
      portfolio
      help [command]
    order
      history
      help [command]
    trade
      quote
      place-order
      cancel
      redeem
      help [command]
    help [command]
  approvals
    list
    detail
    revoke
    help [command]
  defi
    protocol-list
    protocol-info
    investment-list
    investment-info
    position
    deposit
    redeem
    lp-add
    lp-remove
    claim
    preview
    help [command]
  signal
    list
    strategy
      create
      update
      delete
      follow
      unfollow
      list
      list-followed
      help [command]
    backtest
      list
      detail
      retry
      schedule
      help [command]
    explore
    credits
    wallet-group
    help [command]
  tracker
    token
    tx
    follow
    group
      list
      create
      update
      help [command]
    address
      search
      list
      add
      batch
      update
      link
      delete
      follow
      unfollow
      help [command]
    ws
    help [command]
  leaderboard
    query
    analyze
    alpha-radar
    preset
      list
      save
      help [command]
    alpha-radar-config
      list
      save
      help [command]
    help [command]
  contract-call
    preview
    execute
    help [command]
  sign-message
    preview
    execute
    result
    history
    help [command]
  help [command]
```

## Exact CLI evidence

Full output is preserved below, including examples and whitespace within each block. Every command in this appendix exited **0**. These are help transcripts, **not instructions to run the operational examples**.

### `baw --version`

```text
1.10.0
```

### `baw --help`

```text
Usage: baw [options] [command]

CLI wallet tool for payments and crypto

Options:
  -V, --version          output the version number
  --json                 Output in JSON format
  -h, --help             display help for command

Commands:
  skill-check [options]  Check if a skill has a newer version available
  cli-check [options]    Check if the CLI meets the required version
  auth                   Authentication commands (signin, signout, verify QR
                         code status)
  wallet                 Wallet management commands (status, address, balance,
                         send, cancel, speed-up, tx-history, settings,
                         left-quota, tx-lock, chains, gas-price)
  market-order           Market order commands (swap, quote, list)
  limit-order            Limit order commands (buy, sell, list, cancel)
  x402-payment           x402 (B402) payment — preview and sign PaymentRequired
                         responses
  prediction             Prediction market commands (market, category,
                         position, order, trade)
  approvals              Approval management commands (list, detail, revoke)
  defi                   DeFi protocol, investment, and position commands
  signal                 Custom signal commands
  tracker                Wallet Tracker commands (monitor / groups / addresses)
  leaderboard            Leaderboard commands (query / analyze / alpha-radar /
                         preset / alpha-radar-config)
  contract-call          Preview and execute agent wallet contract calls
  sign-message           Preview, execute, and query agent wallet message
                         signatures
  help [command]         display help for command
```


### `baw skill-check --help`

```text
Usage: baw skill-check [options]

Check if a skill has a newer version available

Options:
  --skill-name <skillName>     Skill name to check
  --current-version <version>  Current version to compare against
  -h, --help                   display help for command
```

### `baw cli-check --help`

```text
Usage: baw cli-check [options]

Check if the CLI meets the required version

Options:
  --required-version <version>  Required CLI version
  -h, --help                    display help for command
```

### `baw auth --help`

```text
Usage: baw auth [options] [command]

Authentication commands (signin, signout, verify QR code status)

Options:
  -h, --help        display help for command

Commands:
  signin [options]  Start login flow by displaying a QR code. Scan with Wallet
                    App to authenticate
  signout           Sign out from the wallet by clearing the session
  verify [options]  Verify QR code scan status and poll until wallet creation
                    completes (for async login flow)
  help [command]    display help for command
```

### `baw wallet --help`

```text
Usage: baw wallet [options] [command]

Wallet management commands (status, address, balance, send, cancel, speed-up,
tx-history, settings, left-quota, tx-lock, chains, gas-price)

Options:
  -h, --help                   display help for command

Commands:
  status                       Check authentication status and wallet status
  address                      Get wallet addresses for all supported chains
  balance [options]            Query wallet token balances with USD value. Only
                               shows tokens with non-zero balance
  send [options]               Send tokens to an address
  cancel [options] <txHash>    Cancel a pending transaction by sending a
                               replacement tx with higher gas
  speed-up [options] <txHash>  Speed up a pending transaction by resubmitting
                               with higher gas
  tx-history [options]         Query wallet transaction history with pagination
                               support
  settings                     Query agent wallet settings
  left-quota                   Query daily trading limit usage
  tx-lock [options]            Query transaction lock status for the current
                               chain
  chains                       List available chains for the wallet
  gas-price [options]          Query the three gas price levels for a chain
  help [command]               display help for command
```

### `baw market-order --help`

```text
Usage: baw market-order [options] [command]

Market order commands (swap, quote, list)

Options:
  -h, --help       display help for command

Commands:
  swap [options]   Swap tokens on DEX (market order)
  quote [options]  Get a swap quote for token exchange
  list [options]   List and query market orders with filters
  help [command]   display help for command
```

### `baw limit-order --help`

```text
Usage: baw limit-order [options] [command]

Limit order commands (buy, sell, list, cancel)

Options:
  -h, --help        display help for command

Commands:
  buy [options]     Create a limit buy order (buy token at trigger price)
  sell [options]    Create a limit sell order (sell token at trigger price)
  list [options]    List and query limit orders with filters
  cancel [options]  Cancel a pending limit order by its strategy ID. Cannot
                    cancel executed orders
  help [command]    display help for command
```

### `baw x402-payment --help`

```text
Usage: baw x402-payment [options] [command]

x402 (B402) payment — preview and sign PaymentRequired responses

Options:
  -h, --help         display help for command

Commands:
  preview [options]  Preview x402 payment options from a PaymentRequired
                     response
  sign [options]     Sign a selected x402 payment option and return the replay
                     header value
  help [command]     display help for command
```

### `baw prediction --help`

```text
Usage: baw prediction [options] [command]

Prediction market commands (market, category, position, order, trade)

Options:
  -h, --help      display help for command

Commands:
  market          Prediction market queries (list, detail, search, order-book,
                  last-trade-price)
  category        Prediction market categories
  position        Prediction position queries (list, token, settled-history,
                  pnl, portfolio)
  order           Prediction order queries (history)
  trade           Prediction trading commands (quote, place-order, cancel,
                  redeem)
  help [command]  display help for command
```

### `baw approvals --help`

```text
Usage: baw approvals [options] [command]

Approval management commands (list, detail, revoke)

Options:
  -h, --help        display help for command

Commands:
  list [options]    List token approvals for your wallet
  detail [options]  Show approval detail with recent operation records
  revoke [options]  Revoke a token approval
  help [command]    display help for command
```

### `baw defi --help`

```text
Usage: baw defi [options] [command]

DeFi protocol, investment, and position commands

Options:
  -h, --help                 display help for command

Commands:
  protocol-list [options]    List DeFi protocols with TVL and APY
  protocol-info [options]    Get detailed information about a DeFi protocol
  investment-list [options]  List DeFi investment opportunities
  investment-info [options]  Get detailed information about a DeFi investment
  position [options]         Query your DeFi positions across protocols
  deposit [options]          Deposit / stake / supply assets to a DeFi protocol
  redeem [options]           Redeem / unstake assets from a DeFi protocol
  lp-add [options]           Add liquidity to an LP position (create new or top
                             up existing)
  lp-remove [options]        Remove liquidity from an LP position
  claim [options]            Claim LP fees, protocol/investment rewards, or
                             matured redemptions
  preview [options]          Preview a DeFi transaction (does not broadcast)
  help [command]             display help for command
```

### `baw signal --help`

```text
Usage: baw signal [options] [command]

Custom signal commands

Options:
  -h, --help              display help for command

Commands:
  list [options]          Query custom signal feed (all sources by default)
  strategy                Manage custom signal strategies (create / update /
                          delete / follow)
  backtest                Backtest management (list / detail / retry /
                          schedule)
  explore [options]       Explore official signal strategies
  credits                 Query backtest credits info
  wallet-group [options]  List wallet groups (for fomo-call --wallet-group-id)
  help [command]          display help for command
```

### `baw tracker --help`

```text
Usage: baw tracker [options] [command]

Wallet Tracker commands (monitor / groups / addresses)

Options:
  -h, --help        display help for command

Commands:
  token [options]   Token-dimension monitor (agent own group / public SMY-KOL)
  tx [options]      Transaction-dimension monitor (agent own group / public
                    SMY-KOL)
  follow [options]  List addresses the current user follows (read-only)
  group             Manage tracker address groups
  address           Manage tracker addresses
  ws [options]      Subscribe to WSP push events via WebSocket
  help [command]    display help for command
```

### `baw leaderboard --help`

```text
Usage: baw leaderboard [options] [command]

Leaderboard commands (query / analyze / alpha-radar / preset /
alpha-radar-config)

Options:
  -h, --help             display help for command

Commands:
  query [options]        Query leaderboard (top traders)
  analyze [options]      Analyze a single address (reverse-lookup within top N)
  alpha-radar [options]  Alpha radar query (find addresses holding target
                         tokens)
  preset                 Manage leaderboard filter presets
  alpha-radar-config     Manage alpha radar configs
  help [command]         display help for command
```

### `baw contract-call --help`

```text
Usage: baw contract-call [options] [command]

Preview and execute agent wallet contract calls

Options:
  -h, --help         display help for command

Commands:
  preview [options]  Preview an agent wallet contract call
  execute [options]  Execute a previewed agent wallet contract call
  help [command]     display help for command
```

### `baw sign-message --help`

```text
Usage: baw sign-message [options] [command]

Preview, execute, and query agent wallet message signatures

Options:
  -h, --help         display help for command

Commands:
  preview [options]  Preview an agent wallet message signature
  execute [options]  Execute a previewed agent wallet message signature
  result [options]   Query an agent wallet message signature result
  history [options]  Query agent wallet message signature history
  help [command]     display help for command
```

### `baw help --help`

```text
Usage: baw [options] [command]

CLI wallet tool for payments and crypto

Options:
  -V, --version          output the version number
  --json                 Output in JSON format
  -h, --help             display help for command

Commands:
  skill-check [options]  Check if a skill has a newer version available
  cli-check [options]    Check if the CLI meets the required version
  auth                   Authentication commands (signin, signout, verify QR
                         code status)
  wallet                 Wallet management commands (status, address, balance,
                         send, cancel, speed-up, tx-history, settings,
                         left-quota, tx-lock, chains, gas-price)
  market-order           Market order commands (swap, quote, list)
  limit-order            Limit order commands (buy, sell, list, cancel)
  x402-payment           x402 (B402) payment — preview and sign PaymentRequired
                         responses
  prediction             Prediction market commands (market, category,
                         position, order, trade)
  approvals              Approval management commands (list, detail, revoke)
  defi                   DeFi protocol, investment, and position commands
  signal                 Custom signal commands
  tracker                Wallet Tracker commands (monitor / groups / addresses)
  leaderboard            Leaderboard commands (query / analyze / alpha-radar /
                         preset / alpha-radar-config)
  contract-call          Preview and execute agent wallet contract calls
  sign-message           Preview, execute, and query agent wallet message
                         signatures
  help [command]         display help for command
```

### `baw auth signin --help`

```text
Usage: baw auth signin [options]

Start login flow by displaying a QR code. Scan with Wallet App to authenticate

Options:
  --image     Open QR code as image instead of web URL
  -h, --help  display help for command

Examples:
  baw auth signin
  baw auth signin --image
  baw auth signin --json


```

### `baw auth signout --help`

```text
Usage: baw auth signout [options]

Sign out from the wallet by clearing the session

Options:
  -h, --help  display help for command

Examples:
  baw auth signout
  baw auth signout --json


```

### `baw auth verify --help`

```text
Usage: baw auth verify [options]

Verify QR code scan status and poll until wallet creation completes (for async
login flow)

Options:
  --qrCodeId <id>  QR code ID from "auth signin --json" output (required)
  -h, --help       display help for command

Examples:
  baw auth verify --qrCodeId abc-123
  baw auth verify --qrCodeId abc-123 --json


```

### `baw auth help --help`

```text
Usage: baw auth [options] [command]

Authentication commands (signin, signout, verify QR code status)

Options:
  -h, --help        display help for command

Commands:
  signin [options]  Start login flow by displaying a QR code. Scan with Wallet
                    App to authenticate
  signout           Sign out from the wallet by clearing the session
  verify [options]  Verify QR code scan status and poll until wallet creation
                    completes (for async login flow)
  help [command]    display help for command
```

### `baw wallet status --help`

```text
Usage: baw wallet status [options]

Check authentication status and wallet status

Options:
  -h, --help  display help for command

Examples:
  baw wallet status
  baw wallet status --json


```

### `baw wallet address --help`

```text
Usage: baw wallet address [options]

Get wallet addresses for all supported chains

Options:
  -h, --help  display help for command

Examples:
  baw wallet address
  baw wallet address --json


```

### `baw wallet balance --help`

```text
Usage: baw wallet balance [options]

Query wallet token balances with USD value. Only shows tokens with non-zero
balance

Options:
  --symbol <symbol>                  Filter by token symbol (e.g., BNB, USDC)
  --tokenAddress <tokenAddress>      Filter by token contract address
  --binanceChainId <binanceChainId>  Filter by Binance chain ID
  -h, --help                         display help for command

Examples:
  baw wallet balance
  baw wallet balance --symbol BNB
  baw wallet balance --binanceChainId 56
  baw wallet balance --tokenAddress 0x55d398326f99059fF775485246999027B3197955
  baw wallet balance --json


```

### `baw wallet send --help`

```text
Usage: baw wallet send [options]

Send tokens to an address

Options:
  --amount <amount>                  Amount to send (required unless --max is
                                     set)
  --max                              Send the maximum available balance
  --recipient <recipient>            Recipient address
  --tokenAddress <tokenAddress>      Token contract address
  --gasLevel <gasLevel>              Gas level: LOW, MEDIUM (default), HIGH
                                     (default: "MEDIUM")
  --binanceChainId <binanceChainId>  Binance chain ID
  -h, --help                         display help for command

Examples:
  baw wallet send --binanceChainId 56 --amount 1.0 --tokenAddress 0x55d398326f99059fF775485246999027B3197955 --recipient 0x1234...5678
  baw wallet send --binanceChainId 56 --amount 100 --tokenAddress 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee --recipient 0x1234...5678 --gasLevel LOW
  baw wallet send --binanceChainId 56 --amount 0.5 --tokenAddress 0x55d398326f99059fF775485246999027B3197955 --recipient 0x1234...5678 --json
  baw wallet send --binanceChainId 56 --max --tokenAddress 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee --recipient 0x1234...5678


```

### `baw wallet cancel --help`

```text
Usage: baw wallet cancel [options] <txHash>

Cancel a pending transaction by sending a replacement tx with higher gas

Options:
  --binanceChainId <binanceChainId>  Binance chain ID (optional, auto-detected
                                     from txHash)
  -h, --help                         display help for command

Examples:
  baw wallet cancel 0xabc123...def456
  baw wallet cancel 0xabc123...def456 --binanceChainId 56
  baw wallet cancel 0xabc123...def456 --json


```

### `baw wallet speed-up --help`

```text
Usage: baw wallet speed-up [options] <txHash>

Speed up a pending transaction by resubmitting with higher gas

Options:
  --level <level>                    Gas bump level: LOW (×1.1), HIGH (×1.25)
                                     (default: "HIGH")
  --binanceChainId <binanceChainId>  Binance chain ID (optional, auto-detected
                                     from txHash)
  -h, --help                         display help for command

Examples:
  baw wallet speed-up 0xabc123...def456
  baw wallet speed-up 0xabc123...def456 --level LOW
  baw wallet speed-up 0xabc123...def456 --level HIGH --binanceChainId 56
  baw wallet speed-up 0xabc123...def456 --json


```

### `baw wallet tx-history --help`

```text
Usage: baw wallet tx-history [options]

Query wallet transaction history with pagination support

Options:
  --type <type>                      Filter by status: all (default), pending,
                                     or confirmed
  --binanceChainId <binanceChainId>  Filter by binanceChainId
  --size <size>                      Number of transactions per page (default:
                                     20, max: 100)
  --nextCursor <cursor>              Pagination cursor from previous query for
                                     next page
  --tx <hash>                        Query single transaction details by
                                     transaction hash
  --startTime <timestamp>            Start time in milliseconds (default: 3
                                     months ago)
  --endTime <timestamp>              End time in milliseconds
  -h, --help                         display help for command

Examples:
  baw wallet tx-history
  baw wallet tx-history --type pending
  baw wallet tx-history --binanceChainId 56 --size 50
  baw wallet tx-history --tx 0xabc123...
  baw wallet tx-history --json


```

### `baw wallet settings --help`

```text
Usage: baw wallet settings [options]

Query agent wallet settings

Options:
  -h, --help  display help for command

Examples:
  baw wallet settings
  baw wallet settings --json


```

### `baw wallet left-quota --help`

```text
Usage: baw wallet left-quota [options]

Query daily trading limit usage

Options:
  -h, --help  display help for command

Examples:
  baw wallet left-quota
  baw wallet left-quota --json


```

### `baw wallet tx-lock --help`

```text
Usage: baw wallet tx-lock [options]

Query transaction lock status for the current chain

Options:
  --binanceChainId <binanceChainId>  Binance chain ID
  -h, --help                         display help for command

Examples:
  baw wallet tx-lock --binanceChainId 56
  baw wallet tx-lock --binanceChainId 56 --json


```

### `baw wallet chains --help`

```text
Usage: baw wallet chains [options]

List available chains for the wallet

Options:
  -h, --help  display help for command

Examples:
  baw wallet chains
  baw wallet chains --json


```

### `baw wallet gas-price --help`

```text
Usage: baw wallet gas-price [options]

Query the three gas price levels for a chain

Options:
  --binanceChainId <binanceChainId>  Chain id, e.g. 56, 1, 8453, CT_501
  -h, --help                         display help for command

Units:
  EVM     gasPrice / maxFeePerGas / maxPriorityFeePerGas are in gwei
  Solana  gasPrice is the compute unit price (micro-lamports), tipAmount is priced in SOL

Gas price moves with network conditions. Use it as a reference — it is not a locked quote.

Examples:
  baw wallet gas-price --binanceChainId 56
  baw wallet gas-price --binanceChainId CT_501
  baw wallet gas-price --binanceChainId 56 --json


```

### `baw wallet help --help`

```text
Usage: baw wallet [options] [command]

Wallet management commands (status, address, balance, send, cancel, speed-up,
tx-history, settings, left-quota, tx-lock, chains, gas-price)

Options:
  -h, --help                   display help for command

Commands:
  status                       Check authentication status and wallet status
  address                      Get wallet addresses for all supported chains
  balance [options]            Query wallet token balances with USD value. Only
                               shows tokens with non-zero balance
  send [options]               Send tokens to an address
  cancel [options] <txHash>    Cancel a pending transaction by sending a
                               replacement tx with higher gas
  speed-up [options] <txHash>  Speed up a pending transaction by resubmitting
                               with higher gas
  tx-history [options]         Query wallet transaction history with pagination
                               support
  settings                     Query agent wallet settings
  left-quota                   Query daily trading limit usage
  tx-lock [options]            Query transaction lock status for the current
                               chain
  chains                       List available chains for the wallet
  gas-price [options]          Query the three gas price levels for a chain
  help [command]               display help for command
```

### `baw market-order swap --help`

```text
Usage: baw market-order swap [options]

Swap tokens on DEX (market order)

Options:
  --fromTokenQty <fromTokenQty>      Amount to swap
  --fromToken <fromToken>            Source token address
  --toToken <toToken>                Destination token address
  --slippage <slippage>              Slippage tolerance: "auto" (default) or
                                     0-100
  --mev <mev>                        MEV protection: true (default) or false
                                     (default: "true")
  --gasLevel <gasLevel>              Gas level: LOW, MEDIUM (default), HIGH
                                     (default: "MEDIUM")
  --binanceChainId <binanceChainId>  Binance chain ID
  -h, --help                         display help for command

Examples:
  baw market-order swap --binanceChainId 56 --fromTokenQty 1.3 --fromToken 0x... --toToken 0x...
  baw market-order swap --binanceChainId 56 --fromTokenQty 10 --fromToken 0x55d3...7955 --toToken 0xeeee...eeee
  baw market-order swap --binanceChainId 56 --fromTokenQty 1 --fromToken 0x... --toToken 0x... --mev false --gasLevel HIGH


```

### `baw market-order quote --help`

```text
Usage: baw market-order quote [options]

Get a swap quote for token exchange

Options:
  --fromTokenQty <fromTokenQty>      Amount to swap
  --fromToken <fromToken>            Source token address
  --toToken <toToken>                Destination token address
  --slippage <slippage>              Slippage tolerance: "auto" (default) or
                                     0-100
  --binanceChainId <binanceChainId>  Binance chain ID
  -h, --help                         display help for command

Examples:
  baw market-order quote --binanceChainId 56 --fromTokenQty 1.5 --fromToken 0x... --toToken 0x...
  baw market-order quote --binanceChainId 56 --fromTokenQty 100 --fromToken 0x55d3...7955 --toToken 0xeeee...eeee
  baw market-order quote --binanceChainId 56 --fromTokenQty 10 --fromToken 0x... --toToken 0x... --slippage 1


```

### `baw market-order list --help`

```text
Usage: baw market-order list [options]

List and query market orders with filters

Options:
  --orderId <id>                     Query specific market order by ID (ignores
                                     other filters)
  --binanceChainId <binanceChainId>  Filter by binanceChainId
  --status <status>                  Filter by order status: PENDING, FINISHED,
                                     or FAILED
  --fromToken <address>              Filter by source token contract address
  --toToken <address>                Filter by target token contract address
  --startTime <timestamp>            Filter orders created after this time
                                     (milliseconds timestamp)
  --endTime <timestamp>              Filter orders created before this time
                                     (milliseconds timestamp)
  --page <page>                      Page number for pagination (default: 1)
  --pageSize <size>                  Number of orders per page (default: 20,
                                     max: 100)
  -h, --help                         display help for command

Examples:
  baw market-order list
  baw market-order list --orderId 1234567890
  baw market-order list --status PENDING --page 1 --pageSize 20
  baw market-order list --json


```

### `baw market-order help --help`

```text
Usage: baw market-order [options] [command]

Market order commands (swap, quote, list)

Options:
  -h, --help       display help for command

Commands:
  swap [options]   Swap tokens on DEX (market order)
  quote [options]  Get a swap quote for token exchange
  list [options]   List and query market orders with filters
  help [command]   display help for command
```

### `baw limit-order buy --help`

```text
Usage: baw limit-order buy [options]

Create a limit buy order (buy token at trigger price)

Options:
  --triggerPrice <triggerPrice>      Trigger price in USD (e.g., $100 or 100)
  --fromTokenQty <fromTokenQty>      Amount to spend
  --fromToken <fromToken>            Source token address
  --toToken <toToken>                Token to buy (address)
  --slippage <slippage>              Slippage tolerance: "auto" (default) or
                                     0-100
  --gasLevel <gasLevel>              Gas level: LOW, MEDIUM (default), HIGH
                                     (default: "MEDIUM")
  --mev <mev>                        MEV protection: true (default) or false
                                     (default: "true")
  --binanceChainId <binanceChainId>  Binance chain ID
  -h, --help                         display help for command

Examples:
  baw limit-order buy --binanceChainId 56 --triggerPrice $100 --fromTokenQty 10.1 --fromToken 0x55d3...7955 --toToken 0x...
  baw limit-order buy --binanceChainId 56 --triggerPrice $100 --fromTokenQty 0.4 --fromToken 0xeeee...eeee --toToken 0x...


```

### `baw limit-order sell --help`

```text
Usage: baw limit-order sell [options]

Create a limit sell order (sell token at trigger price)

Options:
  --triggerPrice <triggerPrice>      Trigger price in USD (e.g., $100 or 100)
  --fromTokenQty <fromTokenQty>      Amount of tokens to sell
  --fromToken <fromToken>            Token to sell (address)
  --toToken <toToken>                Destination token address
  --slippage <slippage>              Slippage tolerance: "auto" (default) or
                                     0-100
  --gasLevel <gasLevel>              Gas level: LOW, MEDIUM (default), HIGH
                                     (default: "MEDIUM")
  --mev <mev>                        MEV protection: true (default) or false
                                     (default: "true")
  --binanceChainId <binanceChainId>  Binance chain ID
  -h, --help                         display help for command

Examples:
  baw limit-order sell --binanceChainId 56 --triggerPrice $100 --fromTokenQty 10.1 --fromToken 0x... --toToken 0x55d3...7955
  baw limit-order sell --binanceChainId 56 --triggerPrice $100 --fromTokenQty 10.1 --fromToken 0x... --toToken 0xeeee...eeee


```

### `baw limit-order list --help`

```text
Usage: baw limit-order list [options]

List and query limit orders with filters

Options:
  --strategyId <id>                  Query specific limit order by strategy ID
                                     (ignores other filters)
  --binanceChainId <binanceChainId>  Filter by binanceChainId
  --status <status>                  Filter by order status: PENDING, WORKING,
                                     TRIGGERED, FINISHED, FAILED, EXPIRED, or
                                     CANCELED
  --fromToken <address>              Filter by source token contract address
  --toToken <address>                Filter by target token contract address
  --startTime <timestamp>            Filter orders created after this time
                                     (milliseconds timestamp)
  --endTime <timestamp>              Filter orders created before this time
                                     (milliseconds timestamp)
  --page <page>                      Page number for pagination (default: 1)
  --pageSize <size>                  Number of orders per page (default: 20,
                                     max: 100)
  -h, --help                         display help for command

Examples:
  baw limit-order list
  baw limit-order list --strategyId 9876543210
  baw limit-order list --status WORKING --page 1 --pageSize 20
  baw limit-order list --json


```

### `baw limit-order cancel --help`

```text
Usage: baw limit-order cancel [options]

Cancel a pending limit order by its strategy ID. Cannot cancel executed orders

Options:
  --strategyId <strategyId>  Strategy ID of the limit order to cancel
  -h, --help                 display help for command

Examples:
  baw limit-order cancel --strategyId 9876543210
  baw limit-order cancel --strategyId 9876543210 --json


```

### `baw limit-order help --help`

```text
Usage: baw limit-order [options] [command]

Limit order commands (buy, sell, list, cancel)

Options:
  -h, --help        display help for command

Commands:
  buy [options]     Create a limit buy order (buy token at trigger price)
  sell [options]    Create a limit sell order (sell token at trigger price)
  list [options]    List and query limit orders with filters
  cancel [options]  Cancel a pending limit order by its strategy ID. Cannot
                    cancel executed orders
  help [command]    display help for command
```

### `baw x402-payment preview --help`

```text
Usage: baw x402-payment preview [options]

Preview x402 payment options from a PaymentRequired response

Options:
  --paymentRequirements <value>  The PaymentRequired payload — base64
                                 `PAYMENT-REQUIRED` header value or raw JSON
                                 (auto-detected)
  -h, --help                     display help for command

Examples:
  # raw JSON (easiest when scripting from the 402 response body)
  baw x402-payment preview --paymentRequirements '{"x402Version":2,"accepts":[...]}' --json

  # base64 (avoids shell quoting issues with large or embedded payloads)
  baw x402-payment preview --paymentRequirements "$(cat 402.json | base64)" --json

```

### `baw x402-payment sign --help`

```text
Usage: baw x402-payment sign [options]

Sign a selected x402 payment option and return the replay header value

Options:
  --paymentId <paymentId>  Payment id returned by x402-payment preview
  --selectedIndex <index>  Selected payment option index returned by
                           x402-payment preview
  -h, --help               display help for command

Examples:
  baw x402-payment sign --paymentId 550e8400-e29b-41d4-a716-446655440000 --selectedIndex 1 --json

```

### `baw x402-payment help --help`

```text
Usage: baw x402-payment [options] [command]

x402 (B402) payment — preview and sign PaymentRequired responses

Options:
  -h, --help         display help for command

Commands:
  preview [options]  Preview x402 payment options from a PaymentRequired
                     response
  sign [options]     Sign a selected x402 payment option and return the replay
                     header value
  help [command]     display help for command
```

### `baw prediction market --help`

```text
Usage: baw prediction market [options] [command]

Prediction market queries (list, detail, search, order-book, last-trade-price)

Options:
  -h, --help                  display help for command

Commands:
  list [options]              List prediction markets
  detail [options]            Get prediction market details
  search [options]            Search prediction markets by keyword
  order-book [options]        Get order book for an outcome
  last-trade-price [options]  Get last trade price for a market
  help [command]              display help for command
```

### `baw prediction category --help`

```text
Usage: baw prediction category [options] [command]

Prediction market categories

Options:
  -h, --help      display help for command

Commands:
  list            List prediction market categories (no auth required)
  help [command]  display help for command
```

### `baw prediction position --help`

```text
Usage: baw prediction position [options] [command]

Prediction position queries (list, token, settled-history, pnl, portfolio)

Options:
  -h, --help                 display help for command

Commands:
  list [options]             List prediction positions with PnL summary
  token [options]            Get position by token ID
  settled-history [options]  List settled position history
  pnl [options]              Query PNL records for prediction positions
  portfolio                  Query prediction portfolio summary with active
                             positions and unrealized PNL
  help [command]             display help for command
```

### `baw prediction order --help`

```text
Usage: baw prediction order [options] [command]

Prediction order queries (history)

Options:
  -h, --help         display help for command

Commands:
  history [options]  List prediction order history
  help [command]     display help for command
```

### `baw prediction trade --help`

```text
Usage: baw prediction trade [options] [command]

Prediction trading commands (quote, place-order, cancel, redeem)

Options:
  -h, --help             display help for command

Commands:
  quote [options]        Get a prediction trade quote
  place-order [options]  Place a prediction order using a quote ID
  cancel [options]       Cancel prediction orders
  redeem [options]       Redeem winning prediction positions
  help [command]         display help for command
```

### `baw prediction help --help`

```text
Usage: baw prediction [options] [command]

Prediction market commands (market, category, position, order, trade)

Options:
  -h, --help      display help for command

Commands:
  market          Prediction market queries (list, detail, search, order-book,
                  last-trade-price)
  category        Prediction market categories
  position        Prediction position queries (list, token, settled-history,
                  pnl, portfolio)
  order           Prediction order queries (history)
  trade           Prediction trading commands (quote, place-order, cancel,
                  redeem)
  help [command]  display help for command
```

### `baw approvals list --help`

```text
Usage: baw approvals list [options]

List token approvals for your wallet

Options:
  --spender <address>    Filter by spender address
  --filterTypes <types>  Filter by risk type (high_risk, medium_risk,
                         non_interactive, others)
  --limit <number>       Number of results to return (default: 20)
  --offset <cursor>      Pagination cursor from previous query
  -h, --help             display help for command
```

### `baw approvals detail --help`

```text
Usage: baw approvals detail [options]

Show approval detail with recent operation records

Options:
  --binanceChainId <binanceChainId>  Binance chain ID
  --tokenContract <address>          Token contract address
  --spender <address>                Spender contract address
  --type <type>                      Approval type (approve | permit2)
  -h, --help                         display help for command
```

### `baw approvals revoke --help`

```text
Usage: baw approvals revoke [options]

Revoke a token approval

Options:
  --binanceChainId <binanceChainId>  Binance chain ID
  --tokenContract <address>          Token contract address
  --spender <address>                Spender contract address
  --type <type>                      Approval type (approve | permit2)
  -h, --help                         display help for command
```

### `baw approvals help --help`

```text
Usage: baw approvals [options] [command]

Approval management commands (list, detail, revoke)

Options:
  -h, --help        display help for command

Commands:
  list [options]    List token approvals for your wallet
  detail [options]  Show approval detail with recent operation records
  revoke [options]  Revoke a token approval
  help [command]    display help for command
```

### `baw defi protocol-list --help`

```text
Usage: baw defi protocol-list [options]

List DeFi protocols with TVL and APY

Options:
  --binanceChainId <binanceChainId>  Filter by Binance chain ID (e.g. 56)
  --investType <investType>          Filter by invest type: Earn, Loan,
                                     LiquidityPool
  --sortField <sortField>            Sort by: tvl, apy (default: tvl)
  --sortDirection <sortDirection>    Sort direction: ASC, DESC (default: DESC)
  --page <page>                      Page number (default: 1)
  --size <size>                      Page size (default: 200, max: 200)
  -h, --help                         display help for command

Examples:
  baw defi protocol-list --json
  baw defi protocol-list --investType Earn --json
  baw defi protocol-list --sortField apy --sortDirection DESC --json

```

### `baw defi protocol-info --help`

```text
Usage: baw defi protocol-info [options]

Get detailed information about a DeFi protocol

Options:
  --defiProtocolId <defiProtocolId>  Protocol ID (e.g. venus, aave-v3)
  -h, --help                         display help for command

Examples:
  baw defi protocol-info --defiProtocolId venus --json
  baw defi protocol-info --defiProtocolId aave-v3 --json

```

### `baw defi investment-list --help`

```text
Usage: baw defi investment-list [options]

List DeFi investment opportunities

Options:
  --investType <investType>          Investment type: Earn, Loan, LiquidityPool
  --defiProtocolId <defiProtocolId>  Filter by protocol ID
  --contractAddresses <addresses>    Filter by token contract addresses
                                     (comma-separated, max 2)
  --binanceChainId <binanceChainId>  Filter by Binance chain ID
  --sortField <sortField>            Sort by: apy, tvl (default: apy)
  --sortDirection <sortDirection>    Sort direction: ASC, DESC (default: DESC)
  --page <page>                      Page number (default: 1)
  --size <size>                      Page size (default: 20, max: 100)
  -h, --help                         display help for command

Examples:
  baw defi investment-list --investType Earn --json
  baw defi investment-list --investType Earn --defiProtocolId venus --json
  baw defi investment-list --investType LiquidityPool --sortField tvl --json

```

### `baw defi investment-info --help`

```text
Usage: baw defi investment-info [options]

Get detailed information about a DeFi investment

Options:
  --investmentId <investmentId>  Investment ID
  -h, --help                     display help for command

Examples:
  baw defi investment-info --investmentId venus-bsc-usdt-supply --json

```

### `baw defi position --help`

```text
Usage: baw defi position [options]

Query your DeFi positions across protocols

Options:
  --address <address>                Query a specific address (defaults to user
                                     wallet address)
  --binanceChainId <binanceChainId>  Filter by Binance chain ID (e.g. 56)
  --defiProtocolId <defiProtocolId>  Filter by DeFi protocol ID (e.g. venus,
                                     pancakeswap3)
  --refresh                          Force-refresh positions (skip cache,
                                     rate-limited)
  -h, --help                         display help for command

Examples:
  baw defi position --json
  baw defi position --address 0x66FAa5Ded68CC83a71BC172Fb03C17a6Bcb32f7a --json
  baw defi position --binanceChainId 56 --json
  baw defi position --defiProtocolId venus --json
  baw defi position --refresh --json

```

### `baw defi deposit --help`

```text
Usage: baw defi deposit [options]

Deposit / stake / supply assets to a DeFi protocol

Options:
  --investmentId <investmentId>      Investment product ID
  --tokenAddress <tokenAddress>      Underlying token contract address
  --amount <amount>                  Amount to deposit (human-readable, e.g.
                                     "100")
  --gasLevel <gasLevel>              Gas level: LOW / MEDIUM / HIGH (default:
                                     "MEDIUM")
  --binanceChainId <binanceChainId>  Binance chain ID (default: 56) (default:
                                     "56")
  -h, --help                         display help for command

Examples:
  baw defi deposit --investmentId venus_usdt --tokenAddress 0x... --amount 100
  baw defi deposit --investmentId venus_usdt --tokenAddress 0x... --amount 100 --gasLevel HIGH --json

```

### `baw defi redeem --help`

```text
Usage: baw defi redeem [options]

Redeem / unstake assets from a DeFi protocol

Options:
  --investmentId <investmentId>      Investment product ID
  --tokenAddress <tokenAddress>      Underlying token contract address
  --amount <amount>                  Redeem amount (human-readable); mutually
                                     exclusive with --ratio
  --ratio <ratio>                    Redeem ratio (0, 1]; mutually exclusive
                                     with --amount
  --gasLevel <gasLevel>              Gas level: LOW / MEDIUM / HIGH (default:
                                     "MEDIUM")
  --binanceChainId <binanceChainId>  Binance chain ID (default: 56) (default:
                                     "56")
  -h, --help                         display help for command

Examples:
  baw defi redeem --investmentId venus_usdt --tokenAddress 0x... --amount 50
  baw defi redeem --investmentId venus_usdt --tokenAddress 0x... --ratio 1 --json

```

### `baw defi lp-add --help`

```text
Usage: baw defi lp-add [options]

Add liquidity to an LP position (create new or top up existing)

Options:
  --investmentId <investmentId>      LP investment product ID
  --tokenAddress <tokenAddress>      Token contract address matching --amount
  --amount <amount>                  Amount to deposit (human-readable)
  --nftId <nftId>                    V3/V4 LP NFT tokenId; use to top up an
                                     existing position
  --tickLower <tickLower>            Lower tick of the price range (raw int24,
                                     must be aligned to pool tickSpacing)
  --tickUpper <tickUpper>            Upper tick of the price range (raw int24,
                                     must be aligned to pool tickSpacing)
  --priceRange <percent>             Price range as a percentage of the current
                                     pool price (e.g. "5" for ±5%, range (0,
                                     50])
  --slippageBps <slippageBps>        Slippage in basis points: "auto" or 1-4999
                                     (default: "auto")
  --gasLevel <gasLevel>              Gas level: LOW / MEDIUM / HIGH (default:
                                     "MEDIUM")
  --binanceChainId <binanceChainId>  Binance chain ID (default: 56) (default:
                                     "56")
  -h, --help                         display help for command

LP position source:
  • --nftId <id>                       Top up an existing position; --priceRange and ticks are ignored
  • --priceRange <percent>             New position centered on current price (e.g. 5 = ±5%)
  • --tickLower <int> --tickUpper <int>   New position with explicit ticks
  When --nftId is absent, --priceRange and explicit ticks are mutually exclusive (specify exactly one).

Examples:
  # New position via priceRange (recommended for first-time users)
  baw defi lp-add --investmentId pancake_v3_xxx --tokenAddress 0x... --amount 1 --priceRange 5
  # New position via explicit ticks
  baw defi lp-add --investmentId pancake_v3_xxx --tokenAddress 0x... --amount 1 --tickLower -887220 --tickUpper 887220
  # Top up existing position
  baw defi lp-add --investmentId pancake_v3_xxx --tokenAddress 0x... --amount 1 --nftId 12345 --json

```

### `baw defi lp-remove --help`

```text
Usage: baw defi lp-remove [options]

Remove liquidity from an LP position

Options:
  --investmentId <investmentId>      LP investment product ID
  --nftId <nftId>                    LP NFT tokenId
  --ratio <ratio>                    Removal ratio (0, 1]; "1" removes the full
                                     position
  --slippageBps <slippageBps>        Slippage in basis points: "auto" or 1-4999
                                     (default: "auto")
  --gasLevel <gasLevel>              Gas level: LOW / MEDIUM / HIGH (default:
                                     "MEDIUM")
  --binanceChainId <binanceChainId>  Binance chain ID (default: 56) (default:
                                     "56")
  -h, --help                         display help for command

Examples:
  baw defi lp-remove --investmentId pancake_v3_xxx --nftId 12345 --ratio 1
  baw defi lp-remove --investmentId pancake_v3_xxx --nftId 12345 --ratio 0.5 --slippageBps 100 --json

```

### `baw defi claim --help`

```text
Usage: baw defi claim [options]

Claim LP fees, protocol/investment rewards, or matured redemptions

Options:
  --claimType <claimType>            Claim type: REWARD_PROTOCOL /
                                     REWARD_INVESTMENT / LP_FEE / REDEMPTION
  --investmentId <investmentId>      Investment product ID
  --defiProtocolId <defiProtocolId>  DeFi protocol ID (required for
                                     REWARD_PROTOCOL)
  --nftId <nftId>                    LP NFT tokenId (required for LP_FEE)
  --redemptionId <redemptionId>      Redemption record ID (required for
                                     REDEMPTION)
  --tokenAddress <tokenAddress>      Optional token address to limit the claim
  --gasLevel <gasLevel>              Gas level: LOW / MEDIUM / HIGH (default:
                                     "MEDIUM")
  --binanceChainId <binanceChainId>  Binance chain ID (default: 56) (default:
                                     "56")
  -h, --help                         display help for command

Examples:
  baw defi claim --claimType LP_FEE --investmentId pancake_v3_xxx --nftId 12345
  baw defi claim --claimType REWARD_PROTOCOL --defiProtocolId aave --json
  baw defi claim --claimType REDEMPTION --investmentId lista_yusd --redemptionId redemp_001

```

### `baw defi preview --help`

```text
Usage: baw defi preview [options]

Preview a DeFi transaction (does not broadcast)

Options:
  --action <action>                  Action: deposit / redeem / lp-add /
                                     lp-remove / claim
  --investmentId <investmentId>      Investment product ID
  --tokenAddress <tokenAddress>      Token contract address
  --amount <amount>                  Amount (human-readable)
  --ratio <ratio>                    Ratio (0, 1] (redeem / lp-remove)
  --nftId <nftId>                    LP NFT tokenId
  --tickLower <tickLower>            Lower tick of LP price range (lp-add only)
  --tickUpper <tickUpper>            Upper tick of LP price range (lp-add only)
  --priceRange <percent>             LP price range percentage, e.g. "5" for
                                     ±5% (lp-add only, mutually exclusive with
                                     --nftId / explicit ticks)
  --slippageBps <slippageBps>        Slippage in basis points: "auto" or 1-4999
  --claimType <claimType>            Claim type (claim only)
  --defiProtocolId <defiProtocolId>  DeFi protocol ID (claim REWARD_PROTOCOL)
  --redemptionId <redemptionId>      Redemption record ID (claim REDEMPTION)
  --gasLevel <gasLevel>              Gas level: LOW / MEDIUM / HIGH (default:
                                     "MEDIUM")
  --binanceChainId <binanceChainId>  Binance chain ID (default: 56) (default:
                                     "56")
  -h, --help                         display help for command

Examples:
  baw defi preview --action deposit --investmentId X --tokenAddress 0x... --amount 100
  baw defi preview --action lp-remove --investmentId X --nftId 12345 --ratio 1 --json
  baw defi preview --action claim --claimType LP_FEE --investmentId X --nftId 12345

```

### `baw defi help --help`

```text
Usage: baw defi [options] [command]

DeFi protocol, investment, and position commands

Options:
  -h, --help                 display help for command

Commands:
  protocol-list [options]    List DeFi protocols with TVL and APY
  protocol-info [options]    Get detailed information about a DeFi protocol
  investment-list [options]  List DeFi investment opportunities
  investment-info [options]  Get detailed information about a DeFi investment
  position [options]         Query your DeFi positions across protocols
  deposit [options]          Deposit / stake / supply assets to a DeFi protocol
  redeem [options]           Redeem / unstake assets from a DeFi protocol
  lp-add [options]           Add liquidity to an LP position (create new or top
                             up existing)
  lp-remove [options]        Remove liquidity from an LP position
  claim [options]            Claim LP fees, protocol/investment rewards, or
                             matured redemptions
  preview [options]          Preview a DeFi transaction (does not broadcast)
  help [command]             display help for command
```

### `baw signal list --help`

```text
Usage: baw signal list [options]

Query custom signal feed (all sources by default)

Options:
  -c, --chain-id <chainId>  Chain ID (default: "56")
  -n, --page-size <size>    Number of signals per source (default: "100")
  -s, --source <source>     Signal source: all | user | meme | smart-money
                            (default: "all")
  --strategy-id <id>        Filter by strategy ID (USER_STRATEGY only)
  --strategy-type <type>    Filter by strategy type: meme-rush | fomo-call
                            (USER_STRATEGY only; aliases: meme, fomo)
  --sort-by <field>         Sort: time | maxGain (default: "time")
  --time-range <range>      Time filter: 5m | 1h | 24h
  -h, --help                display help for command
```

### `baw signal strategy --help`

```text
Usage: baw signal strategy [options] [command]

Manage custom signal strategies (create / update / delete / follow)

Options:
  -h, --help               display help for command

Commands:
  create [options]         Create a new signal strategy (estimate → confirm →
                           create)
  update [options]         Update an existing strategy name or config
  delete [options]         Delete a strategy (backtest task)
  follow [options]         Follow a strategy. Hall strategies are copied to
                           your own account first, then followed.
  unfollow [options]       Unfollow a strategy
  list [options]           List all your strategies (owned), optionally
                           filtered by --followed or --type
  list-followed [options]  List strategies you follow
  help [command]           display help for command
```

### `baw signal backtest --help`

```text
Usage: baw signal backtest [options] [command]

Backtest management (list / detail / retry / schedule)

Options:
  -h, --help          display help for command

Commands:
  list [options]      List backtest task stats
  detail [options]    Show backtest detail (task info + token list)
  retry [options]     Retry a failed backtest job (meme-rush only)
  schedule [options]  Configure or query backtest schedule
  help [command]      display help for command
```

### `baw signal explore --help`

```text
Usage: baw signal explore [options]

Explore official signal strategies

Options:
  -c, --chain-id <chainId>  Chain ID
  --backtest-days <days>    Backtest period in days
  -h, --help                display help for command
```

### `baw signal credits --help`

```text
Usage: baw signal credits [options]

Query backtest credits info

Options:
  -h, --help  display help for command
```

### `baw signal wallet-group --help`

```text
Usage: baw signal wallet-group [options]

List wallet groups (for fomo-call --wallet-group-id)

Options:
  -c, --chain-id <chainId>  Chain ID
  -h, --help                display help for command
```

### `baw signal help --help`

```text
Usage: baw signal [options] [command]

Custom signal commands

Options:
  -h, --help              display help for command

Commands:
  list [options]          Query custom signal feed (all sources by default)
  strategy                Manage custom signal strategies (create / update /
                          delete / follow)
  backtest                Backtest management (list / detail / retry /
                          schedule)
  explore [options]       Explore official signal strategies
  credits                 Query backtest credits info
  wallet-group [options]  List wallet groups (for fomo-call --wallet-group-id)
  help [command]          display help for command
```

### `baw tracker token --help`

```text
Usage: baw tracker token [options]

Token-dimension monitor (agent own group / public SMY-KOL)

Options:
  -c, --chain-id <chainId>  Chain ID
  -g, --group-id <groupId>  Group ID (agent own group)
  --tag-type <type>         Public mode tag: kol / smy (omit for agent
                            own-group mode)
  --token-size <n>          Number of recent tokens (default 70)
  --period <period>         Period: 1m/5m/1h/4h/24h (default 24h)
  --filter-risk             Filter risk tokens (default: false)
  -h, --help                display help for command
```

### `baw tracker tx --help`

```text
Usage: baw tracker tx [options]

Transaction-dimension monitor (agent own group / public SMY-KOL)

Options:
  -c, --chain-id <chainId>  Chain ID
  -g, --group-id <groupId>  Group ID (agent own group)
  --tag-type <type>         Public mode tag: kol / smy (omit for agent
                            own-group mode)
  --trade-side <sides>      Comma-separated: 19=buy 11=first-buy 29=sell
                            21=clear
  --min-value <n>           Min tx USD value
  --max-value <n>           Max tx USD value
  --filter-risk             Filter risk tokens (default: false)
  -h, --help                display help for command
```

### `baw tracker follow --help`

```text
Usage: baw tracker follow [options]

List addresses the current user follows (read-only)

Options:
  -c, --chain-id <chainId>  Chain ID
  -h, --help                display help for command
```

### `baw tracker group --help`

```text
Usage: baw tracker group [options] [command]

Manage tracker address groups

Options:
  -h, --help        display help for command

Commands:
  list [options]    List address groups
  create [options]  Create a new group
  update [options]  Rename a group
  help [command]    display help for command
```

### `baw tracker address --help`

```text
Usage: baw tracker address [options] [command]

Manage tracker addresses

Options:
  -h, --help          display help for command

Commands:
  search [options]    Fuzzy search addresses within a group
  list [options]      Paginated address list (address/page)
  add [options]       Add a single address (wraps import)
  batch [options]     Batch import addresses into a group
  update [options]    Update address label/note (merges address/update +
                      address/label/update)
  link [options]      Link an address to a group (address/group/link)
  delete [options]    Delete address(es) from a group (supports batch)
  follow [options]    Follow an address (G9-A)
  unfollow [options]  Unfollow an address (G9-A)
  help [command]      display help for command
```

### `baw tracker ws --help`

```text
Usage: baw tracker ws [options]

Subscribe to WSP push events via WebSocket

Options:
  --smy                     Listen to Smart Money events
  --kol                     Listen to KOL events (requires -c)
  --wallet <chains>         Listen to chain-level events (comma-separated:
                            BSC,SOL,BASE,ETH)
  --following               Listen to current user followings (requires login +
                            -c, mutually exclusive with others)
  --address <addr>          Listen to specific address events (requires -c)
  --address-list <file>     Batch address file, one per line (requires -c, max
                            100)
  -c, --chain-id <chainId>  Chain ID (56=BSC, 1=ETH, 8453=BASE, CT_501=SOL)
  --duration <sec>          Auto-disconnect after N seconds (0 or omit = no
                            limit)
  -h, --help                display help for command
```

### `baw tracker help --help`

```text
Usage: baw tracker [options] [command]

Wallet Tracker commands (monitor / groups / addresses)

Options:
  -h, --help        display help for command

Commands:
  token [options]   Token-dimension monitor (agent own group / public SMY-KOL)
  tx [options]      Transaction-dimension monitor (agent own group / public
                    SMY-KOL)
  follow [options]  List addresses the current user follows (read-only)
  group             Manage tracker address groups
  address           Manage tracker addresses
  ws [options]      Subscribe to WSP push events via WebSocket
  help [command]    display help for command
```

### `baw leaderboard query --help`

```text
Usage: baw leaderboard query [options]

Query leaderboard (top traders)

Options:
  -c, --chain-id <chainId>  Chain ID
  -p, --period <period>     Period: 7d/30d/90d (default: "30d")
  -t, --tag <tag>           Tag: ALL/KOL/MPC (default: "ALL")
  --sort-by <n>             Sort field (0=PnL 20=win 30=vol 50=tx 60=active
                            70=rate 80=tokens) (default: "0")
  --order-by <n>            Order (0/2=desc 1=asc) (default: "0")
  --page <page>             Page number (from 0) (default: "0")
  --size <size>             Page size (max 20) (default: "20")
  -h, --help                display help for command
```

### `baw leaderboard analyze --help`

```text
Usage: baw leaderboard analyze [options]

Analyze a single address (reverse-lookup within top N)

Options:
  -c, --chain-id <chainId>  Chain ID
  -a, --address <address>   Address to analyze
  -p, --period <period>     Period: 7d/30d/90d (default: "30d")
  --top-n <n>               Scan top N entries (default 1000, max 5000)
                            (default: "1000")
  -h, --help                display help for command
```

### `baw leaderboard alpha-radar --help`

```text
Usage: baw leaderboard alpha-radar [options]

Alpha radar query (find addresses holding target tokens)

Options:
  -c, --chain-id <chainId>   Chain ID
  -t, --tokens <tokens>      Comma-separated token addresses
  -m, --match-count <count>  Min number of tokens to match (>=1)
  -p, --period <period>      Period: 7d/30d/90d (default: "30d")
  --page <page>              Page number (from 0) (default: "0")
  --size <size>              Page size (max 20) (default: "20")
  -h, --help                 display help for command
```

### `baw leaderboard preset --help`

```text
Usage: baw leaderboard preset [options] [command]

Manage leaderboard filter presets

Options:
  -h, --help      display help for command

Commands:
  list            List saved presets
  save [options]  Save presets (replaces all; --config is a JSON array of
                  PresetItem)
  help [command]  display help for command
```

### `baw leaderboard alpha-radar-config --help`

```text
Usage: baw leaderboard alpha-radar-config [options] [command]

Manage alpha radar configs

Options:
  -h, --help      display help for command

Commands:
  list [options]  List alpha radar configs
  save [options]  Save alpha radar configs (--config is a JSON array of
                  AlphaRadarConfigItem)
  help [command]  display help for command
```

### `baw leaderboard help --help`

```text
Usage: baw leaderboard [options] [command]

Leaderboard commands (query / analyze / alpha-radar / preset /
alpha-radar-config)

Options:
  -h, --help             display help for command

Commands:
  query [options]        Query leaderboard (top traders)
  analyze [options]      Analyze a single address (reverse-lookup within top N)
  alpha-radar [options]  Alpha radar query (find addresses holding target
                         tokens)
  preset                 Manage leaderboard filter presets
  alpha-radar-config     Manage alpha radar configs
  help [command]         display help for command
```

### `baw contract-call preview --help`

```text
Usage: baw contract-call preview [options]

Preview an agent wallet contract call

Options:
  --binanceChainId <id>  Binance chain ID (e.g. 56 for BSC, 1 for Ethereum,
                         CT_501 for Solana)
  --from <address>       Agentic wallet address on the target chain; backend
                         verifies ownership
  --to <address>         Contract address to interact with (EVM only, required
                         for EVM)
  --value <wei>          Raw eth_sendTransaction value in wei: non-negative
                         integer, decimal or 0x-hex (EVM only)
  --inputData <hex>      EVM calldata, 0x-prefixed hex (EVM only)
  --unsignedTx <base64>  Solana unsigned transaction, base64 encoded (Solana
                         only, required for Solana)
  --gasLimit <n>         EVM custom gas limit, 21000-15000000 (EVM only). Pass
                         only when the user specifies one; omit to let the
                         backend estimate
  -h, --help             display help for command

--gasLimit is a cap, not a bypass: the transaction is still simulated with that value as the
ceiling and the same value goes on chain verbatim. If the call needs more gas than the cap,
preview fails right here instead of the transaction running out of gas after broadcast.
Supply it on preview only — execute takes just the requestId and reuses the previewed value.

Examples:
  baw contract-call preview --binanceChainId 56 --from 0xabc... --to 0xabc... --value 0 --inputData 0x --json
  baw contract-call preview --binanceChainId 56 --from 0xabc... --to 0xabc... --inputData 0x... --gasLimit 300000 --json

```

### `baw contract-call execute --help`

```text
Usage: baw contract-call execute [options]

Execute a previewed agent wallet contract call

Options:
  --requestId <id>  Preview requestId
  -h, --help        display help for command

Examples:
  baw contract-call execute --requestId <requestId> --json

```

### `baw contract-call help --help`

```text
Usage: baw contract-call [options] [command]

Preview and execute agent wallet contract calls

Options:
  -h, --help         display help for command

Commands:
  preview [options]  Preview an agent wallet contract call
  execute [options]  Execute a previewed agent wallet contract call
  help [command]     display help for command
```

### `baw sign-message preview --help`

```text
Usage: baw sign-message preview [options]

Preview an agent wallet message signature

Options:
  --binanceChainId <id>  Binance chain ID (e.g. 56 for BSC, 1 for Ethereum,
                         CT_501 for Solana)
  --message <value>      Message payload — for EIP712, pass an
                         eth_signTypedData_v4 JSON-RPC wrapper string
  --signType <type>      Signature type: EIP712 (EVM typed data)
  -h, --help             display help for command

Examples:
  baw sign-message preview --binanceChainId 56 --message '<typed-data-json>' --signType EIP712 --json

```

### `baw sign-message execute --help`

```text
Usage: baw sign-message execute [options]

Execute a previewed agent wallet message signature

Options:
  --requestId <id>  Preview requestId
  -h, --help        display help for command

Examples:
  baw sign-message execute --requestId <requestId> --json

```

### `baw sign-message result --help`

```text
Usage: baw sign-message result [options]

Query an agent wallet message signature result

Options:
  --order-id <id>  Message signature orderId
  -h, --help       display help for command

Examples:
  baw sign-message result --order-id <orderId> --json

```

### `baw sign-message history --help`

```text
Usage: baw sign-message history [options]

Query agent wallet message signature history

Options:
  --binanceChainId <id>    Filter by Binance chain ID
  --limit <n>              Number of items to return (default: 20) (default:
                           "20")
  --nextToken <token>      Pagination cursor from previous query
  --startTime <timestamp>  Start time in milliseconds
  --endTime <timestamp>    End time in milliseconds
  --sortType <type>        Sort type, e.g. DESC or ASC
  -h, --help               display help for command

Examples:
  baw sign-message history --binanceChainId 56 --limit 20 --json

```

### `baw sign-message help --help`

```text
Usage: baw sign-message [options] [command]

Preview, execute, and query agent wallet message signatures

Options:
  -h, --help         display help for command

Commands:
  preview [options]  Preview an agent wallet message signature
  execute [options]  Execute a previewed agent wallet message signature
  result [options]   Query an agent wallet message signature result
  history [options]  Query agent wallet message signature history
  help [command]     display help for command
```

### `baw prediction market list --help`

```text
Usage: baw prediction market list [options]

List prediction markets

Options:
  --l1Category <category>  L1 category filter (e.g. crypto, sports)
  --l2Category <category>  L2 subcategory filter
  --sortBy <sort>          Sort: RECOMMENDED, VOLUME, PARTICIPANTS,
                           CREATED_TIME, END_DATE
  --orderBy <order>        Order: ASC or DESC (default: DESC) (default: "DESC")
  --offset <offset>        Pagination offset (default: 0)
  --limit <limit>          Page size (default: 20, max: 100)
  -h, --help               display help for command

Examples:
  baw prediction market list
  baw prediction market list --l1Category crypto --limit 5
  baw prediction market list --sortBy VOLUME --orderBy DESC --json

```

### `baw prediction market detail --help`

```text
Usage: baw prediction market detail [options]

Get prediction market details

Options:
  --marketTopicId <id>  Market topic ID
  -h, --help            display help for command

Examples:
  baw prediction market detail --marketTopicId 123456
  baw prediction market detail --marketTopicId 123456 --json

```

### `baw prediction market search --help`

```text
Usage: baw prediction market search [options]

Search prediction markets by keyword

Options:
  --query <query>  Search keyword (max 200 chars)
  --limit <limit>  Max results (default: 10, max: 50)
  -h, --help       display help for command

Examples:
  baw prediction market search --query "Bitcoin"
  baw prediction market search --query "FIFA World Cup" --limit 5 --json

```

### `baw prediction market order-book --help`

```text
Usage: baw prediction market order-book [options]

Get order book for an outcome

Options:
  --marketId <id>      Market ID (not marketTopicId, use market detail to find)
  --tokenId <tokenId>  Outcome token ID
  -h, --help           display help for command

Examples:
  baw prediction market order-book --marketId 5237837 --tokenId 123456789 --json

Note: --marketId is the sub-market ID, not the marketTopicId.
Use 'baw prediction market detail --marketTopicId <id>' to find marketId.

```

### `baw prediction market last-trade-price --help`

```text
Usage: baw prediction market last-trade-price [options]

Get last trade price for a market

Options:
  --marketId <id>  Market ID (not marketTopicId, use market detail to find)
  -h, --help       display help for command

Examples:
  baw prediction market last-trade-price --marketId 5237837 --json

Note: --marketId is the sub-market ID, not the marketTopicId.
Use 'baw prediction market detail --marketTopicId <id>' to find marketId.

```

### `baw prediction market help --help`

```text
Usage: baw prediction market [options] [command]

Prediction market queries (list, detail, search, order-book, last-trade-price)

Options:
  -h, --help                  display help for command

Commands:
  list [options]              List prediction markets
  detail [options]            Get prediction market details
  search [options]            Search prediction markets by keyword
  order-book [options]        Get order book for an outcome
  last-trade-price [options]  Get last trade price for a market
  help [command]              display help for command
```

### `baw prediction category list --help`

```text
Usage: baw prediction category list [options]

List prediction market categories (no auth required)

Options:
  -h, --help  display help for command

Examples:
  baw prediction category list
  baw prediction category list --json

```

### `baw prediction category help --help`

```text
Usage: baw prediction category [options] [command]

Prediction market categories

Options:
  -h, --help      display help for command

Commands:
  list            List prediction market categories (no auth required)
  help [command]  display help for command
```

### `baw prediction position list --help`

```text
Usage: baw prediction position list [options]

List prediction positions with PnL summary

Options:
  --tab <tab>        Filter: ONGOING, ENDED, PENDING_CLAIM (default: ONGOING)
  --offset <offset>  Pagination offset (default: 0)
  --limit <limit>    Page size (default: 20, max: 100)
  -h, --help         display help for command

Examples:
  baw prediction position list
  baw prediction position list --tab PENDING_CLAIM --json

```

### `baw prediction position token --help`

```text
Usage: baw prediction position token [options]

Get position by token ID

Options:
  --tokenId <tokenId>  ERC-1155 Token ID
  -h, --help           display help for command

Examples:
  baw prediction position token --tokenId 123456789
  baw prediction position token --tokenId 123456789 --json

```

### `baw prediction position settled-history --help`

```text
Usage: baw prediction position settled-history [options]

List settled position history

Options:
  --l1Category <category>  L1 category filter
  --filter <filter>        Result filter: all, win, lose (default: all)
  --offset <offset>        Pagination offset (default: 0)
  --limit <limit>          Page size (default: 20, max: 100)
  -h, --help               display help for command

Examples:
  baw prediction position settled-history
  baw prediction position settled-history --filter win
  baw prediction position settled-history --filter lose --json

```

### `baw prediction position pnl --help`

```text
Usage: baw prediction position pnl [options]

Query PNL records for prediction positions

Options:
  --tokenId <tokenId>      Filter by specific token ID
  --l1Category <category>  L1 category filter: crypto, sports, all
  --offset <offset>        Pagination offset (default: 0)
  --limit <limit>          Page size (default: 20, max: 100)
  -h, --help               display help for command

Examples:
  baw prediction position pnl
  baw prediction position pnl --l1Category crypto
  baw prediction position pnl --tokenId abc123 --json

```

### `baw prediction position portfolio --help`

```text
Usage: baw prediction position portfolio [options]

Query prediction portfolio summary with active positions and unrealized PNL

Options:
  -h, --help  display help for command

Examples:
  baw prediction position portfolio
  baw prediction position portfolio --json

```

### `baw prediction position help --help`

```text
Usage: baw prediction position [options] [command]

Prediction position queries (list, token, settled-history, pnl, portfolio)

Options:
  -h, --help                 display help for command

Commands:
  list [options]             List prediction positions with PnL summary
  token [options]            Get position by token ID
  settled-history [options]  List settled position history
  pnl [options]              Query PNL records for prediction positions
  portfolio                  Query prediction portfolio summary with active
                             positions and unrealized PNL
  help [command]             display help for command
```

### `baw prediction order history --help`

```text
Usage: baw prediction order history [options]

List prediction order history

Options:
  --status <status>        Filter by status: PENDING, SUBMITTED, FILLED,
                           PARTIALLY_FILLED, CANCELLED, FAILED, EXPIRED
  --l1Category <category>  L1 category filter
  --orderType <type>       Filter by type: MARKET, LIMIT
  --offset <offset>        Pagination offset (default: 0)
  --limit <limit>          Page size (default: 20, max: 100)
  -h, --help               display help for command

Examples:
  baw prediction order history
  baw prediction order history --status FILLED --limit 10
  baw prediction order history --orderType LIMIT --json

```

### `baw prediction order help --help`

```text
Usage: baw prediction order [options] [command]

Prediction order queries (history)

Options:
  -h, --help         display help for command

Commands:
  history [options]  List prediction order history
  help [command]     display help for command
```

### `baw prediction trade quote --help`

```text
Usage: baw prediction trade quote [options]

Get a prediction trade quote

Options:
  --binanceChainId <binanceChainId>  Binance chain ID: 56 (BSC), 137 (Polygon)
  --tokenId <tokenId>                ERC1155 Outcome Token ID
  --marketTopicId <marketTopicId>    Market topic ID. If --slippageBps is
                                     omitted, the market default slippage is
                                     fetched via this ID
  --side <side>                      Trade side: BUY or SELL
  --amount <amount>                  Trade amount in USDT (human-readable)
  --orderType <type>                 Order type: MARKET or LIMIT
  --slippageBps <bps>                Slippage in basis points (default: use
                                     market slippageBps)
  --priceLimit <price>               Limit price in USDT (required for LIMIT
                                     orders)
  -h, --help                         display help for command

Examples:
  baw prediction trade quote --binanceChainId 56 --tokenId abc123 --marketTopicId 100 --side BUY --amount 10 --orderType MARKET
  baw prediction trade quote --binanceChainId 56 --tokenId abc123 --marketTopicId 100 --side BUY --amount 5 --orderType LIMIT --priceLimit 0.6 --json

```

### `baw prediction trade place-order --help`

```text
Usage: baw prediction trade place-order [options]

Place a prediction order using a quote ID

Options:
  --quoteId <quoteId>   Quote ID from trade quote command
  --orderType <type>    Order type: MARKET (default) or LIMIT
  --slippageBps <bps>   Slippage in basis points (from quote response
                        slippageBps field)
  --priceLimit <price>  Limit price in USDT (required for LIMIT orders)
  -h, --help            display help for command

Examples:
  baw prediction trade place-order --quoteId quote_abc123 --slippageBps 1000
  baw prediction trade place-order --quoteId quote_abc123 --slippageBps 1000 --orderType LIMIT --priceLimit 0.6 --json

```

### `baw prediction trade cancel --help`

```text
Usage: baw prediction trade cancel [options]

Cancel prediction orders

Options:
  --orderIds <ids>  Comma-separated order IDs to cancel
  -h, --help        display help for command

Examples:
  baw prediction trade cancel --orderIds order_123,order_456
  baw prediction trade cancel --orderIds order_123 --json

```

### `baw prediction trade redeem --help`

```text
Usage: baw prediction trade redeem [options]

Redeem winning prediction positions

Options:
  --tokenIds <ids>                   Comma-separated list of winning token IDs
  --binanceChainId <binanceChainId>  Binance chain ID filter
  -h, --help                         display help for command

Examples:
  baw prediction trade redeem --tokenIds token_123,token_456
  baw prediction trade redeem --tokenIds token_123 --binanceChainId 56 --json

```

### `baw prediction trade help --help`

```text
Usage: baw prediction trade [options] [command]

Prediction trading commands (quote, place-order, cancel, redeem)

Options:
  -h, --help             display help for command

Commands:
  quote [options]        Get a prediction trade quote
  place-order [options]  Place a prediction order using a quote ID
  cancel [options]       Cancel prediction orders
  redeem [options]       Redeem winning prediction positions
  help [command]         display help for command
```

### `baw signal strategy create --help`

```text
Usage: baw signal strategy create [options]

Create a new signal strategy (estimate → confirm → create)

Options:
  -c, --chain-id <chainId>     Chain ID
  -t, --type <type>            Strategy type: meme-rush | fomo-call (aliases:
                               meme, fomo)
  -n, --name <name>            Strategy name (max 20 chars)
  --config <config>            Strategy config (JSON string)
  --wallet-group-id <groupId>  Wallet group ID (required for fomo-call, merged
                               into config.selectedGroups)
  --run-backtest               Trigger backtest on creation (sets
                               config.backtest.enabled=true)
  -h, --help                   display help for command
```

### `baw signal strategy update --help`

```text
Usage: baw signal strategy update [options]

Update an existing strategy name or config

Options:
  -c, --chain-id <chainId>  Chain ID
  -t, --type <type>         Strategy type: meme-rush | fomo-call (aliases:
                            meme, fomo)
  --job-id <jobId>          Job ID
  -n, --name <name>         New strategy name
  --config <config>         New strategy config (JSON string)
  -y, --yes                 Skip confirmation prompt
  -h, --help                display help for command
```

### `baw signal strategy delete --help`

```text
Usage: baw signal strategy delete [options]

Delete a strategy (backtest task)

Options:
  -c, --chain-id <chainId>  Chain ID
  -t, --type <type>         Strategy type: meme-rush | fomo-call (aliases:
                            meme, fomo)
  --job-id <jobId>          Job ID
  -y, --yes                 Skip confirmation prompt
  -h, --help                display help for command
```

### `baw signal strategy follow --help`

```text
Usage: baw signal strategy follow [options]

Follow a strategy. Hall strategies are copied to your own account first, then
followed.

Options:
  -c, --chain-id <chainId>  Chain ID
  -t, --type <type>         Strategy type: meme-rush | fomo-call (aliases:
                            meme, fomo)
  --job-id <jobId>          Job ID
  --task-id <taskId>        Task ID (used to look up the strategy; hall
                            strategies default to 1) (default: "1")
  -n, --name <name>         Name for the copied strategy (only used when
                            copying a hall strategy; max 20 chars)
  -y, --yes                 Skip the copy confirmation prompt for hall
                            strategies
  -h, --help                display help for command
```

### `baw signal strategy unfollow --help`

```text
Usage: baw signal strategy unfollow [options]

Unfollow a strategy

Options:
  -c, --chain-id <chainId>    Chain ID
  -t, --type <type>           Strategy type: meme-rush | fomo-call (aliases:
                              meme, fomo)
  --strategy-id <strategyId>  Strategy ID
  -y, --yes                   Skip confirmation prompt
  -h, --help                  display help for command
```

### `baw signal strategy list --help`

```text
Usage: baw signal strategy list [options]

List all your strategies (owned), optionally filtered by --followed or --type

Options:
  -c, --chain-id <chainId>  Chain ID
  --followed                Only show followed strategies
  --type <strategyType>     Filter by strategy type: meme-rush | fomo-call
  -h, --help                display help for command
```

### `baw signal strategy list-followed --help`

```text
Usage: baw signal strategy list-followed [options]

List strategies you follow

Options:
  -c, --chain-id <chainId>  Chain ID
  -h, --help                display help for command
```

### `baw signal strategy help --help`

```text
Usage: baw signal strategy [options] [command]

Manage custom signal strategies (create / update / delete / follow)

Options:
  -h, --help               display help for command

Commands:
  create [options]         Create a new signal strategy (estimate → confirm →
                           create)
  update [options]         Update an existing strategy name or config
  delete [options]         Delete a strategy (backtest task)
  follow [options]         Follow a strategy. Hall strategies are copied to
                           your own account first, then followed.
  unfollow [options]       Unfollow a strategy
  list [options]           List all your strategies (owned), optionally
                           filtered by --followed or --type
  list-followed [options]  List strategies you follow
  help [command]           display help for command
```

### `baw signal backtest list --help`

```text
Usage: baw signal backtest list [options]

List backtest task stats

Options:
  -c, --chain-id <chainId>  Chain ID
  -p, --page <page>         Page number (ignored when --all is used) (default:
                            "1")
  -s, --size <size>         Page size (default: "20")
  --backtest-days <days>    Backtest period in days
  --all                     Fetch all pages automatically (overrides
                            --page/--size)
  -h, --help                display help for command
```

### `baw signal backtest detail --help`

```text
Usage: baw signal backtest detail [options]

Show backtest detail (task info + token list)

Options:
  -c, --chain-id <chainId>    Chain ID
  --strategy-id <strategyId>  Strategy ID
  -h, --help                  display help for command
```

### `baw signal backtest retry --help`

```text
Usage: baw signal backtest retry [options]

Retry a failed backtest job (meme-rush only)

Options:
  -c, --chain-id <chainId>  Chain ID
  -t, --type <type>         Strategy type (default: meme-rush) (default:
                            "meme-rush")
  --job-id <jobId>          Job ID
  -h, --help                display help for command
```

### `baw signal backtest schedule --help`

```text
Usage: baw signal backtest schedule [options]

Configure or query backtest schedule

Options:
  -c, --chain-id <chainId>  Chain ID
  --job-id <jobId>          Job ID
  --interval <interval>     Schedule interval: 4H | 6H | 12H | 24H | OFF (omit
                            to query only)
  -h, --help                display help for command
```

### `baw signal backtest help --help`

```text
Usage: baw signal backtest [options] [command]

Backtest management (list / detail / retry / schedule)

Options:
  -h, --help          display help for command

Commands:
  list [options]      List backtest task stats
  detail [options]    Show backtest detail (task info + token list)
  retry [options]     Retry a failed backtest job (meme-rush only)
  schedule [options]  Configure or query backtest schedule
  help [command]      display help for command
```

### `baw tracker group list --help`

```text
Usage: baw tracker group list [options]

List address groups

Options:
  -c, --chain-id <chainId>  Chain ID
  --no-all-group            Exclude the "All" virtual group
  -h, --help                display help for command
```

### `baw tracker group create --help`

```text
Usage: baw tracker group create [options]

Create a new group

Options:
  -c, --chain-id <chainId>  Chain ID
  -n, --name <name>         Group name
  -h, --help                display help for command
```

### `baw tracker group update --help`

```text
Usage: baw tracker group update [options]

Rename a group

Options:
  -c, --chain-id <chainId>  Chain ID
  -g, --group-id <groupId>  Group ID
  -n, --name <name>         New group name
  -h, --help                display help for command
```

### `baw tracker group help --help`

```text
Usage: baw tracker group [options] [command]

Manage tracker address groups

Options:
  -h, --help        display help for command

Commands:
  list [options]    List address groups
  create [options]  Create a new group
  update [options]  Rename a group
  help [command]    display help for command
```

### `baw tracker address search --help`

```text
Usage: baw tracker address search [options]

Fuzzy search addresses within a group

Options:
  -c, --chain-id <chainId>  Chain ID
  -g, --group-id <groupId>  Group ID
  -a, --address <address>   Address filter (fuzzy)
  -l, --label <label>       Label filter (fuzzy)
  -h, --help                display help for command
```

### `baw tracker address list --help`

```text
Usage: baw tracker address list [options]

Paginated address list (address/page)

Options:
  -c, --chain-id <chainId>  Chain ID
  -g, --group-id <groupId>  Group ID
  --page <page>             Page number (from 1) (default: "1")
  --size <size>             Page size (max 100) (default: "20")
  -h, --help                display help for command
```

### `baw tracker address add --help`

```text
Usage: baw tracker address add [options]

Add a single address (wraps import)

Options:
  -c, --chain-id <chainId>  Chain ID
  -a, --address <address>   Address
  -l, --label <label>       Label
  -g, --group-id <groupId>  Group ID (default group if omitted)
  --no-overwrite            Do not overwrite existing label/emoji
  -h, --help                display help for command
```

### `baw tracker address batch --help`

```text
Usage: baw tracker address batch [options]

Batch import addresses into a group

Options:
  -c, --chain-id <chainId>  Chain ID
  -a, --addresses <list>    Comma-separated addresses, or JSON array of
                            {address,label}
  -g, --group-id <groupId>  Group ID (default group if omitted)
  --no-overwrite            Do not overwrite existing label/emoji
  -h, --help                display help for command
```

### `baw tracker address update --help`

```text
Usage: baw tracker address update [options]

Update address label/note (merges address/update + address/label/update)

Options:
  -c, --chain-id <chainId>  Chain ID
  -a, --address <address>   Address
  -l, --label <label>       New label/note
  -h, --help                display help for command
```

### `baw tracker address link --help`

```text
Usage: baw tracker address link [options]

Link an address to a group (address/group/link)

Options:
  -c, --chain-id <chainId>  Chain ID
  -a, --address <address>   Address
  -g, --group-id <groupId>  Target group ID (default group if omitted)
  -y, --yes                 Skip confirmation prompt
  -h, --help                display help for command
```

### `baw tracker address delete --help`

```text
Usage: baw tracker address delete [options]

Delete address(es) from a group (supports batch)

Options:
  -c, --chain-id <chainId>  Chain ID
  -g, --group-id <groupId>  Group ID
  -a, --addresses <list>    Comma-separated addresses to delete
  -y, --yes                 Skip confirmation prompt
  -h, --help                display help for command
```

### `baw tracker address follow --help`

```text
Usage: baw tracker address follow [options]

Follow an address (G9-A)

Options:
  -c, --chain-id <chainId>  Chain ID
  -a, --address <address>   Address
  -g, --group-id <groupId>  Group ID
  -l, --label <label>       Label
  -h, --help                display help for command
```

### `baw tracker address unfollow --help`

```text
Usage: baw tracker address unfollow [options]

Unfollow an address (G9-A)

Options:
  -c, --chain-id <chainId>  Chain ID
  -a, --address <address>   Address
  -h, --help                display help for command
```

### `baw tracker address help --help`

```text
Usage: baw tracker address [options] [command]

Manage tracker addresses

Options:
  -h, --help          display help for command

Commands:
  search [options]    Fuzzy search addresses within a group
  list [options]      Paginated address list (address/page)
  add [options]       Add a single address (wraps import)
  batch [options]     Batch import addresses into a group
  update [options]    Update address label/note (merges address/update +
                      address/label/update)
  link [options]      Link an address to a group (address/group/link)
  delete [options]    Delete address(es) from a group (supports batch)
  follow [options]    Follow an address (G9-A)
  unfollow [options]  Unfollow an address (G9-A)
  help [command]      display help for command
```

### `baw leaderboard preset list --help`

```text
Usage: baw leaderboard preset list [options]

List saved presets

Options:
  -h, --help  display help for command
```

### `baw leaderboard preset save --help`

```text
Usage: baw leaderboard preset save [options]

Save presets (replaces all; --config is a JSON array of PresetItem)

Options:
  --config <json>  JSON array of preset items
  -h, --help       display help for command
```

### `baw leaderboard preset help --help`

```text
Usage: baw leaderboard preset [options] [command]

Manage leaderboard filter presets

Options:
  -h, --help      display help for command

Commands:
  list            List saved presets
  save [options]  Save presets (replaces all; --config is a JSON array of
                  PresetItem)
  help [command]  display help for command
```

### `baw leaderboard alpha-radar-config list --help`

```text
Usage: baw leaderboard alpha-radar-config list [options]

List alpha radar configs

Options:
  -c, --chain-id <chainId>  Chain ID
  -h, --help                display help for command
```

### `baw leaderboard alpha-radar-config save --help`

```text
Usage: baw leaderboard alpha-radar-config save [options]

Save alpha radar configs (--config is a JSON array of AlphaRadarConfigItem)

Options:
  -c, --chain-id <chainId>  Chain ID
  --config <config>         JSON array of AlphaRadarConfigItem
  -h, --help                display help for command
```

### `baw leaderboard alpha-radar-config help --help`

```text
Usage: baw leaderboard alpha-radar-config [options] [command]

Manage alpha radar configs

Options:
  -h, --help      display help for command

Commands:
  list [options]  List alpha radar configs
  save [options]  Save alpha radar configs (--config is a JSON array of
                  AlphaRadarConfigItem)
  help [command]  display help for command
```
