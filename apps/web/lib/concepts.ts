/** Short explanations behind the "Read more" links. Each ends in a link to `/docs#how-<id>`, where the full write-up with references will live. */
export interface Concept {
  id: string;
  title: string;
  /** Plain words: what it is and why it works that way. */
  paragraphs: string[];
}

export const CONCEPTS: Record<string, Concept> = {
  shares: {
    id: "shares",
    title: "Why Tally counts in shares",
    paragraphs: [
      "A tokenized stock is not always one share per token. Ondo's NFLX token is ten shares, and issuers change the number of shares per token over time (for dividends and stock splits).",
      "Comparing token prices would therefore mislead you. Tally multiplies every token by its current share multiplier, so every quote, balance and guarantee is in the same unit: shares of the stock.",
    ],
  },
  guarantee: {
    id: "guarantee",
    title: "How the minimum is guaranteed",
    paragraphs: [
      "Your trade goes through a smart contract that holds nothing between transactions. After the swap it counts the shares your tokens are worth and reverts the whole transaction if they are below the minimum you saw.",
      "Because the check runs on-chain, it does not depend on Tally, on the route, or on a promise: if the minimum is not met, nothing is spent except the network fee of the failed attempt.",
    ],
  },
  slippage: {
    id: "slippage",
    title: "What slippage is",
    paragraphs: [
      "Prices move between the moment you see a quote and the moment your transaction is mined. Slippage is how much worse than the quote you are willing to accept.",
      "Tally turns it into a floor: the minimum amount to receive is the quoted shares minus your slippage. A tighter setting protects you more but can make a fast-moving trade fail; a looser one fills more often at a slightly worse price.",
    ],
  },
  premium: {
    id: "premium",
    title: 'What "vs US price" means',
    paragraphs: [
      "The reference is the stock's price on US markets. A token's price per share on BNB Chain can sit above or below it, because the token trades on its own market and the US market may be closed.",
      "Negative means the token is cheaper than the US price for the same share; positive means you pay a premium. Tally ranks issuers by the price per share you actually pay, network fee included.",
    ],
  },
  liquidity: {
    id: "liquidity",
    title: "Liquid and Low Liquidity",
    paragraphs: [
      "Tally checks every token's data before you can buy it: trading volume, whether the share multiplier is sane, whether the price agrees with the US price, and whether the issuer has paused it. Each check can cost points on a grade from A to F.",
      "Liquid means grade A or B: plenty of trading and no data problems found. Low Liquidity means C to F: something looked thin or inconsistent, and the reasons are listed so you can judge for yourself.",
    ],
  },
  "not-tradable": {
    id: "not-tradable",
    title: "Why some tokens are Not Tradable",
    paragraphs: [
      "A token that traded under $1,000 in the last 24 hours on BNB Chain has no real market. Its price can be stale by days, and a buy could fill far from the price you see.",
      "Tally marks those tokens Not Tradable and does not let you buy them, even when the issuer's own data looks fine.",
    ],
  },
  "unit-trap": {
    id: "unit-trap",
    title: "What a unit trap is",
    paragraphs: [
      "A unit trap is a token that is more than one share. Its price looks ten times higher than a one-share token, or its balance looks ten times smaller, so a quick glance misreads how much you own or pay.",
      "Tally flags these and always shows the number of shares, which is the only number that compares fairly.",
    ],
  },
  fee: {
    id: "fee",
    title: "The network fee",
    paragraphs: [
      "Every transaction on BNB Smart Chain costs a small fee paid in BNB, usually a few cents. Tally adds no fee of its own.",
      "The fee shown is an estimate from simulating your exact trade, and it is included when issuers are ranked, so a cheaper token that costs more to buy does not win unfairly.",
    ],
  },
  radar: {
    id: "radar",
    title: "How Radar grades tokens",
    paragraphs: [
      "Radar reads each tokenized stock's own data, the on-chain multiplier, and market volume, and cross-checks them against each other. Every check writes a line you can read, whether or not it costs points.",
      "A missing fact is reported as missing, never guessed. The grade is a summary; the reasons under it are the evidence.",
    ],
  },
  portfolio: {
    id: "portfolio",
    title: "How your holdings are counted",
    paragraphs: [
      "Tally reads your balances straight from the chain, so nothing about your holdings is stored on Tally's servers.",
      "Tokens from different issuers of the same stock are added up in shares, and valued at the US price per share. The value refreshes every few seconds while the page is open.",
    ],
  },
};

export type ConceptId = keyof typeof CONCEPTS;
