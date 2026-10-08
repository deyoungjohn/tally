# WO-01 follow-up (urgent): the app shows the wrong wallet after sign-out and a different sign-in

Same worktree and branch as WO-01 (fast-forward to `main` first). No new branch; commit, push, keep an open PR with the latest push.

## What the chief engineer saw (8 Oct)
Disconnected the wallet, signed in with Google to copy the embedded wallet's address: Tally kept showing the address and balances of the previously connected external wallet (OKX). Signing in with a second Google account showed the same external address and balances.

## Cause (read the code, prove it in a test)
`apps/web/components/wallet/privy-wallet.tsx` picks the wallet with `wallets.find(w => w.walletClientType !== "privy") ?? wallets.find(privy)` whenever `authenticated`. Privy's `useWallets()` lists external wallets that are still connected in the browser, whoever is signed in. `logout()` leaves the extension connected. So after any later sign-in, by any Google account, the leftover external wallet "wins". It is not the signed-in user's wallet: it was never linked to that account (`connectWallet`, not link), so the server's session routes (which check the Privy user's linked accounts) refuse it, while the UI shows it and its balances as if it were theirs.

## Fix
1. Extract the choice into a pure function `pickWallet({ authenticated, wallets, explicitAddress })` with tests. An external wallet is used **only if the user connected it on purpose in the current signed-in session** (`connectExternal()` records its address in the bridge state, cleared on logout and whenever the Privy user id changes). Otherwise the embedded wallet is used. Never fall back to a leftover external wallet.
2. `logout()` must also disconnect every external wallet Privy lists (`wallet.disconnect()` inside try/catch; a failure must not block the logout) and clear that state, so the next sign-in starts clean.
3. When the Privy user id changes (sign-in as a different account without a reload), reset every wallet-derived cache that is keyed by address or kept in the page: published wallet value, `useJson` data for portfolio, holdings and quotes (they must refetch, never show the old address's balances while loading), `tally.activeWallet.*` is fine as it is keyed by address.
4. Bind saved in-progress work to its wallet: `tally.pendingSell` (in `use-sell-flow.ts`, a small approved change) stores the wallet address and is ignored (and removed) when the signed-in wallet differs. (The same for `tally.pendingMigrate` is handled in the WO-13 prompt.) Add tests.
5. Show which wallet is active: the account menu already shows the short address; add the word "Embedded" or "External wallet" next to it so the user can tell which one they are using.
6. Tests: unit tests for `pickWallet` (not authenticated, embedded only, external connected but not chosen, external chosen, user changed, external disconnected); a mock-provider test for the bridge if the e2e mock hook allows it. Do not weaken existing wallet tests. Remember the wallet bridge rule (functions stay in refs) and run `NEXT_PUBLIC_PRIVY_APP_ID=clx0000000000000000000000 pnpm build && pnpm e2e` as CLAUDE.md says.
7. Report the real `FULL=1 bash scripts/review-pack.sh <branch>` output.
