# Brief for Opus 5.5: write and direct the Tally demo video (4:00 maximum)

You write the narration script, the shot list and the on-screen text; the chief engineer records the screen, clones their own voice in ElevenLabs and edits. You may not run any transaction, and the demo shows only real, labelled data.

## Read first
`README.md` (what it is, the roadmap), `TALLY_BLUEPRINT.md` §1 to §4 and §17 (the old 4-minute script is out of date), `DESIGN.md`, `docs/FEATURES.md` if present (plain-language list), `docs/evidence/` and `IDEAS.md` §F9 to §F11 (live proof), `docs/devex.md` (findings, evidence pointers only).

## Story (one line)
One token is not one share: Ondo NFLX is 10 shares per token, bStock is 1. Tally shows and guarantees what you get in shares, across every issuer, and an agent can do the same.

## Beats to cover, in this order of importance (cut from the bottom, never pad)
1. The hook: the unit trap, real numbers (NFLX 10 versus 1; a naive tool shows +869%).
2. A real guarded buy on BSC from the website: shares promised, shares received, the receipt in shares, the BscScan link. Show the guarantee refusing a shortfall (the recorded revert) in one cut.
3. Migrate between issuers (live, two receipts and the one combined receipt, plus its shareable link) and a sell.
4. The Pies mini: a Big Tech basket bought one stock after another from a budget (only if its live test passes on Saturday; otherwise cut it and say "coming next").
5. The agent layer: Claude Code with the Binance wallet skill and Tally's MCP tools buying through the guarantee; the unattended sale that needed no tap (V-AW, evidence in `docs/evidence/V-AW-live-sell.md`).
6. Radar (ghost markets), Guardian on Telegram, Portfolio in shares with suggestions.
7. Close: the upstream pull request, the developer-experience findings (pointers only; the report itself is the chief engineer's own writing and must not be quoted as if AI-written), and the roadmap in one breath (README Roadmap).

## Rules for the script
- Every number on screen or spoken must come from a file in this repo or a transaction on BscScan; quote the source in the shot list. Never imply users buy the underlying shares: say "tokenized shares". Fixture data is never presented as live. No keys, RPC URLs or secrets in any frame.
- Spoken pace about 150 words per minute; total narration at most 560 words for a 3:45 cut; short sentences, no jargon without a half-line of explanation, no hype words. Write for ElevenLabs: plain text paragraphs, numbers written as they are said, `<break time="0.4s" />` only where a pause is wanted.
- Deliver: (a) the narration in numbered segments with timecodes, (b) a shot list (what is on screen, which page or terminal, which real transaction hash to show, cursor moves), (c) on-screen captions, (d) a pre-recording checklist (funded demo wallet, the exact $6 buys and sequence, browser profile, tabs, notifications off, what to pre-warm), (e) a fallback for each live step if it fails (a recorded clip to cut in).
- Ask the chief engineer before you invent anything you cannot find in the repo.
