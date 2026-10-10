---
description: Developer documentation for Tally, the share-true layer for tokenized US stocks on BNB Chain.
---

# Welcome to Tally

Tally shows what a tokenized stock really is: how many **shares** you get, not how many tokens. It compares the same US stock across the three issuers on BNB Chain (Ondo, bStock and xStocks), buys from the cheapest tradable one, and refuses to complete a trade if you would receive fewer shares than the minimum you saw.

{% hint style="info" %}
These pages are for developers and the curious: how Tally was built, why it works the way it does, and the contracts behind it. If you only want to use the app, read [How it works](https://app.tallyprotocol.xyz/how-it-works) instead.
{% endhint %}

## Why it exists

One token of a tokenized stock is not one share. Ondo's NFLX token is ten shares, bStock's NFLX token is one, and issuers change the number of shares per token over time. A tool that compares raw token prices sees fake price gaps of hundreds of percent. Tally converts everything into shares first, then checks the numbers against the chain.

## Where to start

{% content-ref url="getting-started/what-is-tally.md" %}
[what-is-tally.md](getting-started/what-is-tally.md)
{% endcontent-ref %}

{% content-ref url="concepts/the-unit-trap.md" %}
[the-unit-trap.md](concepts/the-unit-trap.md)
{% endcontent-ref %}

{% content-ref url="smart-contracts/shareguard-overview.md" %}
[shareguard-overview.md](smart-contracts/shareguard-overview.md)
{% endcontent-ref %}

{% content-ref url="building-tally/the-story.md" %}
[the-story.md](building-tally/the-story.md)
{% endcontent-ref %}

## Links

| | |
|---|---|
| App | [app.tallyprotocol.xyz](https://app.tallyprotocol.xyz) |
| Source code | [github.com/deyoungjohn/tally](https://github.com/deyoungjohn/tally) |
| Built for | BNB Hack: Tokenized Stocks Edition |

{% hint style="warning" %}
Tokenized stocks track a US stock's price. They are not the underlying shares and carry no shareholder rights. ShareGuard has not been independently audited. Read the [security model](architecture/security-model.md) before trusting it with more than test amounts.
{% endhint %}
