// The text of the Terms of Use and the Privacy Policy, one place to edit. Each section is a heading plus paragraphs; a section can
// also carry a bullet list. The pages (app/terms, app/privacy) only lay this out. Change the facts at the top first.
//
// These documents were drafted from how the app actually works. They are not legal advice: have a lawyer who knows the
// jurisdictions Tally serves read them before launch, and update LEGAL when the legal entity, contact address or governing law are set.

export const LEGAL = {
  /** Shown on both pages, and the date the text last changed. */
  updated: "10 October 2026",
  owner: "Tally Protocol",
  /** Where people reach the team. Replace with an email address when one exists. */
  contactLabel: "the Tally repository on GitHub",
  contactHref: "https://github.com/deyoungjohn/tally",
  /** Set when the legal entity is registered, for example "the laws of England and Wales". Until then the Terms say so. */
  governingLaw: null as string | null,
  restricted:
    "the United States, Canada, the United Kingdom, Japan, the Netherlands, Iran, Cuba, North Korea, Syria, Crimea, Donetsk and Luhansk",
};

export interface LegalSection {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
}

export const TERMS_INTRO =
  "These terms govern your use of the Tally website and tools. By using Tally you agree to them. If you do not agree, do not use Tally.";

export const TERMS: LegalSection[] = [
  {
    id: "what",
    title: "What Tally is",
    paragraphs: [
      `${LEGAL.owner} ("Tally", "we") provides a website and related tools that compare tokenized versions of US stocks across issuers on BNB Smart Chain, show them in share units, and prepare purchase and sale transactions that you sign yourself.`,
      "Tally is not a broker, exchange, bank, custodian or investment adviser. Tally does not issue, mint, redeem or hold tokens, and it never holds your funds or keys. Nothing on Tally is investment, legal or tax advice.",
    ],
  },
  {
    id: "eligibility",
    title: "Who can use Tally",
    paragraphs: [
      "You must be at least 18 years old (or the age of majority where you live) and able to enter into a binding agreement.",
      `Tally is not available in, and you must not use it from, ${LEGAL.restricted}. You must not be a resident or citizen of those places, and you must not be the subject of sanctions or on a sanctions list. Tally checks your location when you visit and asks you to confirm this. Using a VPN, proxy or similar tool to get around the check is a breach of these terms.`,
      "You are responsible for knowing whether buying tokenized stocks is lawful where you live.",
    ],
  },
  {
    id: "tokens",
    title: "Tokenized stocks are not shares",
    paragraphs: [
      "What you buy through Tally are tokens issued by third parties (such as Ondo, bStocks and xStocks) that follow the price of a US stock. They are not the underlying shares. You get no shareholder rights, such as voting or direct dividends, unless an issuer says otherwise in its own terms.",
      "Each issuer's own terms, restrictions and risks apply to its tokens. Issuers can pause tokens, change how many shares a token represents, or stop supporting them. A token's market price can differ from the US price of the stock, especially when US markets are closed, and it can fall to zero.",
    ],
  },
  {
    id: "wallet",
    title: "Your wallet and your responsibility",
    paragraphs: [
      "Tally is non-custodial. Your wallet is created and secured through our sign-in provider, or you connect your own wallet. You sign every transaction yourself. Tally cannot move your funds, reverse a transaction or recover a lost key.",
      "Blockchain transactions are final. You are responsible for keeping your sign-in methods and any exported key safe, for having USDT and a small amount of BNB on BNB Smart Chain for the purchase and the network fee, and for checking each confirmation screen before you sign.",
    ],
  },
  {
    id: "guarantee",
    title: "Quotes, the guarantee and what it does not cover",
    paragraphs: [
      "Quotes are estimates from third-party data and expire within seconds. Before you sign, Tally shows a minimum number of shares. Your purchase goes through a smart contract that checks, after the swap and in the same transaction, that the tokens received are worth at least that minimum in shares, and cancels the whole transaction if they are not. You then pay only the network fee of the attempt.",
      "This guarantee depends on the share multiplier the issuer publishes and on the contract working as written. It does not protect you against a price that falls after you buy, an issuer pausing or changing a token, a fault in an issuer's own systems, a wrong or late data feed, or a bug in a smart contract. The contract's code is public and verified on BscScan, but smart contracts can contain errors and you should not treat any of this as risk-free.",
    ],
  },
  {
    id: "data",
    title: "Information on Tally",
    paragraphs: [
      "Prices, share multipliers, liquidity readings and Radar grades come from third parties and from public blockchains. They can be delayed, incomplete or wrong. A grade describes data quality and trading activity at one moment. It is not a recommendation to buy or sell.",
      "Where Tally cannot read something, it says so. Features marked Soon are not available and may change or never launch.",
    ],
  },
  {
    id: "fees",
    title: "Fees",
    paragraphs: [
      "At the time of writing Tally adds no fee of its own. You pay the blockchain network fee, and the price you pay already includes the issuer's and the market's spread. If Tally adds a fee later, it will be shown before you confirm.",
    ],
  },
  {
    id: "use",
    title: "Acceptable use",
    paragraphs: ["You agree not to:"],
    bullets: [
      "use Tally for anything unlawful, or to evade sanctions, or to launder money or finance crime;",
      "get around the region check or any other access control;",
      "send automated requests beyond normal use, scrape the service at scale, or try to overload, probe or break it;",
      "interfere with other people's use of Tally, or attempt to access data or accounts that are not yours.",
    ],
  },
  {
    id: "third",
    title: "Third-party services",
    paragraphs: [
      "Tally relies on services we do not control, including sign-in and wallet providers, the Binance Web3 API, token issuers, blockchain RPC providers, Cloudflare, Telegram (for optional alerts) and BscScan. They have their own terms and can fail or change. We are not responsible for them.",
    ],
  },
  {
    id: "ip",
    title: "Ownership",
    paragraphs: [
      "The Tally name, logo and site design belong to Tally Protocol. Company names and token logos shown on Tally identify the companies and tokens concerned and belong to their owners; their use here does not imply endorsement.",
    ],
  },
  {
    id: "disclaimer",
    title: "No warranty",
    paragraphs: [
      'Tally is provided "as is" and "as available". To the fullest extent the law allows, we give no warranty that it will be uninterrupted, accurate, secure or fit for a particular purpose, and we do not promise any outcome from using it.',
    ],
  },
  {
    id: "liability",
    title: "Limit of liability",
    paragraphs: [
      "To the fullest extent the law allows, Tally Protocol and the people who work on it are not liable for losses from market movements, token or issuer events, third-party failures, wallet or key loss, blockchain congestion or errors, or your reliance on information shown on Tally, and are not liable for indirect or consequential loss, or lost profits.",
      "Nothing in these terms limits liability that cannot be limited by law.",
    ],
  },
  {
    id: "changes",
    title: "Suspension and changes",
    paragraphs: [
      "We can change, suspend or stop any part of Tally, or block access, at any time, including to follow the law. We can update these terms; the date at the top shows when they last changed, and using Tally after a change means you accept it. Where the law requires it, we will ask you again.",
    ],
  },
  {
    id: "law",
    title: "Governing law",
    paragraphs: [
      LEGAL.governingLaw
        ? `These terms are governed by ${LEGAL.governingLaw}, and its courts have jurisdiction, except where your local consumer law says otherwise.`
        : "These terms are governed by the law of the place where Tally Protocol is legally established. That place will be named here when the legal entity is registered. Your local consumer protection rights are not affected.",
    ],
  },
  {
    id: "contact",
    title: "Contact",
    paragraphs: [
      "Questions about these terms can be raised through the contact point at the bottom of this page.",
    ],
  },
];

export const PRIVACY_INTRO =
  "Tally is built to need as little personal data as possible: there is no advertising, no tracking pixels and no selling of data. This page says what we do process, why, who else sees it and how long it is kept.";

export const PRIVACY: LegalSection[] = [
  {
    id: "who",
    title: "Who is responsible",
    paragraphs: [
      `${LEGAL.owner} decides how and why the data described here is processed, and is the controller of it. How to reach us is at the bottom of this page.`,
    ],
  },
  {
    id: "collect",
    title: "What we process",
    bullets: [
      "Your wallet address, and the public blockchain data tied to it (balances, transfers, transactions). This is public by nature. We read it to show your Portfolio, Activity and Statement, and to prepare your transactions.",
      "Sign-in. You sign in with an email address, a Google account or a wallet through our sign-in provider, Privy, which creates the wallet and holds the login details under its own privacy policy. Tally receives the proof of who you are (an access token that our server checks) and your wallet address. Tally does not store your email address.",
      "Your location. Cloudflare adds the country and region of your connection to each request. We use it to block restricted regions. Your IP address is used for that check and for rate limiting while the request is handled; the application does not keep it afterwards, but our hosting and Cloudflare keep ordinary access logs.",
      "Your region declaration. When you confirm you are not in a restricted region we store the version of the wording you accepted, the time, the country and region the request came from and, if you were signed in, your wallet address. We keep it to show we asked.",
      "Your transactions made through Tally. For a purchase or sale we record the transaction hash, the wallet, the stock, the quoted and the received amounts and the outcome, to show your Activity and Statement and to measure how fills compare with quotes. The public list of recent fills on the home page shows only the transaction hash, the stock, the time, the share count and the price, never a wallet address.",
      "Wallet snapshots. After you sign in, our server may keep refreshing a snapshot of your public holdings so your Portfolio and Statement load quickly.",
      "Alerts. If you link Telegram for Guardian alerts, we store your Telegram chat identifier, the link code, your alert settings and the alerts we sent you.",
      "On your device. Tally keeps small items in your browser storage so a purchase, sale or basket you started can be resumed after a reload, and to remember that your wallet was registered in this tab. Our sign-in provider and Cloudflare may set cookies or storage that they need to work. Tally sets no advertising or analytics cookies.",
      "Technical logs. Our servers log errors and basic request details (time, address, page, error) so we can keep the service running and secure.",
    ],
  },
  {
    id: "why",
    title: "Why we process it, and on what basis",
    bullets: [
      "To provide Tally to you (quotes, trades, portfolio, alerts): this is needed to perform our agreement with you.",
      "To block restricted regions and keep the declaration record: this is a legal and regulatory need, and our legitimate interest in following the law.",
      "To keep the service secure, stop abuse and fix faults: our legitimate interest.",
      "Alerts through Telegram: your consent, which you can withdraw by unlinking.",
    ],
  },
  {
    id: "share",
    title: "Who else sees it",
    paragraphs: ["We do not sell your data. We share it only as needed to run Tally:"],
    bullets: [
      "Privy (sign-in and wallet creation).",
      "Cloudflare (delivery, security and the location headers).",
      "Binance Web3 API: to build a quote or a swap for you, our server sends it the token, the amount and your wallet address.",
      "Blockchain RPC providers: our server reads chain data and submits nothing on your behalf; they see the addresses we ask about.",
      "Telegram, if you link alerts.",
      "Our hosting provider, which runs our servers.",
      "Authorities, where the law requires us to disclose something.",
      "Anything you send to the blockchain is public and permanent, and is visible to everyone, including on BscScan.",
    ],
  },
  {
    id: "keep",
    title: "How long we keep it",
    paragraphs: [
      "Region declarations are kept for as long as we need them to show compliance. Transaction records and wallet snapshots are kept while Tally runs and are not deleted on a fixed schedule yet; ask us if you want yours removed. Telegram links and alert history are kept until you unlink or ask us to delete them. Browser storage stays until you clear it. Data written to a blockchain cannot be deleted by anyone.",
    ],
  },
  {
    id: "where",
    title: "Where it is processed",
    paragraphs: [
      "Our servers are in South Korea. Privy, Cloudflare and Telegram process data in other countries, including the United States. By using Tally you accept that your data is processed there, under the protections those providers describe.",
    ],
  },
  {
    id: "rights",
    title: "Your choices and rights",
    paragraphs: [
      "Depending on where you live, you may have the right to ask for a copy of your data, to correct it, to delete it, to limit or object to how we use it, to take it with you, and to complain to your data protection authority. You can also sign out, unlink Telegram, and clear your browser storage at any time. We will answer a request within a reasonable time. Data on a blockchain, and your login details at Privy, are outside what we can delete.",
    ],
  },
  {
    id: "security",
    title: "Security",
    paragraphs: [
      "We keep keys and secrets out of the browser, check sign-in proofs on our server, and limit who can reach our servers. No system is perfectly secure, and we cannot promise it. Tally never has your private key.",
    ],
  },
  {
    id: "children",
    title: "Children",
    paragraphs: [
      "Tally is not for anyone under 18, and we do not knowingly process children's data.",
    ],
  },
  {
    id: "changes",
    title: "Changes",
    paragraphs: [
      "When we change this policy we change the date at the top. If a change matters to you, we will say so on the site.",
    ],
  },
  {
    id: "contact",
    title: "Contact",
    paragraphs: [
      "Questions and requests about your data can be raised through the contact point at the bottom of this page.",
    ],
  },
];
