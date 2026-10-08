# WO-06: Telegram bot polish (4 items)

Stay in your existing worktree and branch (fast-forward to `main` first). No new branch. Owns: `apps/bot/`, and `packages/mod-guardian/` only for the unlink function. For the web part (item 4) you may edit the one Guardian component that shows the link code and its "Open" link, plus the env wiring; if that component belongs to the WO-12 UI work, make the smallest change and say so in the PR.

No keys, no tokens in logs. Never print `TELEGRAM_BOT_TOKEN`.

## 1. Command suggestions when the user types `/`

Telegram only shows the command list if the bot registers it. On startup, call `bot.api.setMyCommands` with every command and a one-line description (start, link, unlink, alerts, quiet, quote, shares, shield, help; match what `handleHelp` lists). Use the default scope. A failure must warn through `onWarn` and not stop the bot. Test it with a stubbed API.

## 2. Unlink

Add `/unlink`:
- Linked chat: remove the link, turn off its alerts, reply "Unlinked from wallet 0x… . You will get no more alerts. Send /link CODE to link again."
- Not linked: say so, change nothing.
- Add the function in `packages/mod-guardian` next to `getLinkedWalletForChat`; it must be idempotent and must not touch other chats or wallets.
- Add it to `/help` and to the command list in item 1.
- Tests: linked, not linked, twice in a row, and a second wallet linked to another chat stays linked.

## 3. Tappable wallet address

Everywhere the bot prints the wallet address (after `/link`, in `/start` when linked, `/alerts`), show it so a tap copies it. In Telegram that is a MarkdownV2 or HTML `code` span with the full address (`<code>0x…</code>` with `parse_mode: "HTML"`, or backticks with Markdown if the replies already use that). Check what parse mode the replies use now: if a reply is sent without a parse mode, backticks show literally, so set it explicitly and escape any other text. Show the full address, not a shortened one. Test the exact string.

## 4. "Open" goes to the bot, not `?start=<code>`

The Guardian page's "Open" link must go to `https://t.me/<bot username>` with no `start` parameter. The user then types `/link CODE` themselves (the page already shows the code). Bot username comes from an env value, not a hard-coded name: `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` (public, no `@`). If it is unset, the page shows the code and the text "Open the Tally bot in Telegram and send /link CODE" and no Open button; it must not crash or build a bad URL. Add the variable to `deploy/tally.env.example` and to the env list and the flag table in `docs/deployment.md` (that file only; no steps anywhere else). Note there that `NEXT_PUBLIC_*` values are inlined at build time, so `--build` is needed after changing it.

`/start CODE` keeps working in the bot (harmless), but no page links to it.

## Done when

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` pass; run `bash scripts/review-pack.sh <your branch>` on a quiet machine and paste the result.
- Commit, push, and make sure the open PR (or a new one from this same branch if it was merged) has the latest push, with the template filled in.
- Report in the PR: what the user must do to see each item (restart the bot via `docs/deployment.md`, set the username env, rebuild).
