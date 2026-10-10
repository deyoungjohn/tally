# Guardian and the Telegram bot

Guardian watches the tokens in your wallet and tells you when something changes. Alerts are private to the wallet that linked them, so linking needs a sign-in.

## Rules

| Rule | Fires when |
|---|---|
| Paused or halted | An issuer pauses a token you hold. Ondo's status comes from the API; bStock's from its shared pause manager. |
| Share count changed | A token's share multiplier changes: "Your token count is the same; your shares rose 0.6% (dividend reinvested)." |
| Grade drop | A held token falls to a lower Radar grade. |
| Thin liquidity (ghost) | Trading on a held token drops under $1,000 in 24 hours. |
| Price threshold | The market price crosses a limit you set. |
| Earnings | A token you hold is limited around earnings. |

Alerts are de-duplicated, respect quiet hours (set in UTC) and can be turned on and off per rule in the Guardian settings.

## Linking Telegram

1. Open Guardian while signed in and generate a link code: eight characters, valid for ten minutes, with at most five attempts in ten minutes.
2. Open the Tally bot and send `/link CODE`. The link is stored against your wallet and the chat.
3. `/unlink` removes it and stops alerts.

Saving settings is a **verified write**: the server verifies your Privy access token and checks the wallet against your own linked accounts before it accepts a change. The page cannot change another wallet's settings by naming it.

## Bot commands

| Command | What it does |
|---|---|
| `/quote TICKER [usd]` | Compare issuers in shares (default $25, minimum $6). |
| `/shares 0xADDRESS` | Holdings in shares across issuers for any address. |
| `/shield TICKER` | Integrity grades, traps and flags for one stock. |
| `/link CODE`, `/unlink` | Link or unlink your wallet. |
| `/alerts on|off` | Turn Guardian notifications on or off. |
| `/quiet 22-07`, `/quiet off` | Quiet hours in UTC. |
| `/help` | The list above. |

The bot is **read-only**: it never builds or sends a transaction. The bot registers its command list so Telegram shows suggestions when you type `/`, and it prints wallet addresses in a form you can copy with a tap.

## Design choice

Guardian's alert history and link records live in the same snapshot store as everything else, and are among the kinds that retention never prunes.
