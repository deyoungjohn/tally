# Quickstart

## Use the app

1. Open [app.tallyprotocol.xyz](https://app.tallyprotocol.xyz) and sign in with email or Google. Tally creates an embedded wallet for you on BNB Smart Chain in a few seconds. You can also connect an external wallet.
2. Send USDT and a few cents of BNB (for network fees) to the wallet address shown in the account menu.
3. Pick a stock on Trade, enter an amount of at least 6 USDT, and compare the issuers. The row marked best is the one that gives the most shares for your money, fee included.
4. Review. The sheet shows the **minimum shares** you will receive. Confirm, then sign the approval and the swap in your wallet.
5. Open the receipt. It shows the shares you received against the floor, read from the chain.

{% hint style="info" %}
The first buy of a token needs an approval transaction before the swap. Tally approves exactly the amount you are spending, and the contract resets the approval to zero afterwards.
{% endhint %}

## Run the engine locally

You do not need a Binance key or a wallet to try the engine. Fixture mode replays recorded Seoul quotes.

```bash
git clone --recurse-submodules https://github.com/deyoungjohn/tally.git
cd tally
pnpm install
pnpm --silent tally quote NVDA 25 --fixtures
```

The output ranks the issuers for $25 of NVDA in shares, with the premium to the US price, the route and the fee. Add `--json` for machine-readable output, `--checks` to print the integrity log under the quote, and `ladder` instead of `quote` for a $6 to $1,000 comparison.

{% hint style="warning" %}
Live quotes need `BINANCE_W3_API_KEY` and `BINANCE_W3_API_SECRET`, and the Binance Web3 API refuses callers in some countries (error `40304`, sent as HTTP 200). Tally's own server runs in Seoul for that reason. See [Challenges](../building-tally/challenges.md).
{% endhint %}

Running a server (workers, environment names, hosting) is covered in the repository's [deployment guide](https://github.com/deyoungjohn/tally/blob/main/docs/deployment.md), which is the single source for those steps.
