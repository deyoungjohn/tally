import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/motion/button";
import { GRADE_BANDS, GRADE_INTRO, GRADE_RULES } from "@/lib/grade-rules";

export const metadata: Metadata = {
  title: "How It Works | Tally",
  description:
    "How Tally compares tokenized stocks in share units, buys from the best issuer and guarantees the shares you receive.",
};

const DOCS_URL = "https://docs.tallyprotocol.xyz";

const NAV = [
  ["what", "What Tally is"],
  ["tokenized", "What you are buying"],
  ["shares", "Why we count in shares"],
  ["issuers", "The three issuers"],
  ["start", "Getting started"],
  ["how", "How a buy works"],
  ["guarantee", "The guarantee"],
  ["fees", "Fees and limits"],
  ["radar", "Reading Radar"],
  ["portfolio", "Your portfolio"],
  ["sell", "Selling and Migrate"],
  ["guardian", "Guardian alerts"],
  ["pies", "Baskets"],
  ["limits", "What can go wrong"],
  ["more", "Learn more"],
] as const;

export default function HowItWorks() {
  return (
    <main id="main" className="wrap pb-24 pt-10 min-[561px]:pt-14">
      <p className="t-kicker">How it works</p>
      <h1 className="t-h2 mt-3 max-w-[24ch]">Tokenized stocks, counted in shares.</h1>
      <p className="t-lead mt-4 max-w-[62ch]">
        A plain-language guide to what Tally does, what you are buying, and what protects you. No
        crypto background needed.
      </p>
      <div className="mt-8 grid grid-cols-1 gap-8 min-[981px]:grid-cols-[240px_minmax(0,1fr)]">
        <nav
          aria-label="On this page"
          className="min-[981px]:sticky min-[981px]:top-24 min-[981px]:self-start"
        >
          <ul className="m-0 grid list-none gap-1 p-0">
            {NAV.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="nav-link block hover:bg-[var(--hl)]">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid min-w-0 gap-6 [&_h2]:t-h3 [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-fg [&_p]:text-fg2 [&_p]:leading-7 [&_section]:glass [&_section]:scroll-mt-28 [&_section]:p-6 min-[561px]:[&_section]:p-8">
          <section id="what">
            <h2>What Tally is</h2>
            <p className="mt-3">
              Tally helps you buy and track tokenized US stocks on BNB Chain. It does three things
              an ordinary swap screen does not. It shows what you really get, in <b>shares</b> of
              the stock, not in tokens. It compares the same stock across every issuer and buys from
              the cheapest one that can actually be traded. And it protects the buy: if you would
              receive fewer shares than the minimum you saw, the whole trade is cancelled and your
              money stays in your wallet.
            </p>
            <p className="mt-3">
              Tally never holds your money or your keys. You approve every step in your own wallet.
            </p>
          </section>

          <section id="tokenized">
            <h2>What you are buying</h2>
            <p className="mt-3">
              A tokenized stock is a token on BNB Chain that follows the price of a US stock. You do
              not own the underlying share and you get no shareholder rights, such as votes. Each
              issuer&apos;s own terms apply, and the issuers can pause a token, for example around
              earnings or a change of trading session.
            </p>
            <p className="mt-3">
              Tally is a secondary-market tool. It never creates or redeems tokens with the issuer,
              and nothing on this site is investment advice.
            </p>
          </section>

          <section id="shares">
            <h2>Why we count in shares</h2>
            <h3 id="how-shares">One token is not always one share</h3>
            <p className="mt-2">
              Each token is worth a number of shares, called its <b>multiplier</b>. For one issuer,
              Ondo, the NFLXon token is ten shares. For another, bStock, the NFLXB token is one.
              That is why Ondo&apos;s NFLX token costs about ten times as much. Comparing the raw
              token prices makes a perfectly fair market look like a 900% gap.
            </p>
            <p className="mt-3">
              Tally multiplies every token by its multiplier, so every quote, balance and guarantee
              is in the same unit: shares of the stock.
            </p>
            <h3 id="how-unit-trap">The unit trap</h3>
            <p className="mt-2">
              A <b>unit trap</b> is when a token is more than one share, so its price and balance
              look off by that factor. Tally flags it with a badge.
            </p>
            <h3>The multiplier changes</h3>
            <p className="mt-2">
              When a company pays a dividend, some issuers raise the multiplier instead of paying
              cash. You then own the same number of tokens but more shares. Tally shows that as
              shares gained. If Tally cannot read a token&apos;s multiplier, it says so and leaves
              that token out of your share totals. It never assumes one token is one share.
            </p>
          </section>

          <section id="issuers">
            <h2>The three issuers</h2>
            <ul className="mt-3 grid list-disc gap-2 pl-6 text-fg2 leading-7">
              <li>
                <b>Ondo</b> tokens end in <i>on</i>, for example NVDAon.
              </li>
              <li>
                <b>bStock</b> tokens end in <i>B</i>, for example NVDAB.
              </li>
              <li>
                <b>xStocks</b> tokens end in <i>x</i>. On BNB Chain they have almost no trading, so
                Tally shows them for information and does not let you buy them.
              </li>
            </ul>
            <p className="mt-3">
              The same stock is usually priced within a fraction of a percent across issuers, but
              the cheapest one changes minute to minute, and with the amount. That is why Tally asks
              each issuer live.
            </p>
          </section>

          <section id="start">
            <h2>Getting started</h2>
            <ol className="mt-3 grid list-decimal gap-2 pl-6 text-fg2 leading-7">
              <li>
                <b>Sign in</b> with your email or Google. Tally creates a wallet for you in a few
                seconds. You can also connect a wallet you already have.
              </li>
              <li>
                <b>Add funds.</b> Send USDT and a few cents of BNB to your wallet address, both on
                the BNB Smart Chain network (BEP-20). USDT is what you spend. BNB pays the network
                fee. Anything sent on another network is lost.
              </li>
              <li>
                <b>Pick a stock</b> on Trade, enter an amount of at least $6 and compare the
                issuers. The one marked best gives the most shares for your money, fee included.
              </li>
            </ol>
          </section>

          <section id="how">
            <h2>How a buy works</h2>
            <ol className="mt-3 grid list-decimal gap-2 pl-6 text-fg2 leading-7">
              <li>
                Tally asks every issuer for a price at the same moment, converts to shares and ranks
                them by price per share with the network fee included.
              </li>
              <li>
                The first time you buy with a wallet, you <b>approve</b> Tally to use exactly the
                USDT you are spending, never an unlimited amount.
              </li>
              <li>
                Tally builds a fresh quote and <b>tests the trade</b> with the exact network fee it
                will send. If the test fails, you are not asked to sign.
              </li>
              <li>
                You see the <b>minimum shares</b> you will receive. You confirm and sign in your
                wallet.
              </li>
              <li>
                Your <b>receipt</b> shows the shares you actually received, read from the chain, and
                a link to the transaction.
              </li>
            </ol>
            <h3 id="how-premium">&ldquo;vs US price&rdquo;</h3>
            <p className="mt-2">
              The reference is the stock&apos;s price on US markets. A token can trade a little
              above or below it, because it has its own market and US markets are not always open.
              Negative means cheaper than the US price for the same share. Positive means you pay a
              premium.
            </p>
            <h3 id="how-slippage">Slippage</h3>
            <p className="mt-2">
              Prices move between seeing a quote and your trade being confirmed. Slippage is how
              much worse than the quote you will accept. Tally turns it into a floor: your minimum
              shares are the quoted shares minus your slippage (1% by default). A tighter setting
              protects you more, but can make a fast-moving trade fail.
            </p>
          </section>

          <section id="guarantee">
            <h2>The guarantee</h2>
            <h3 id="how-guarantee">What it promises</h3>
            <p className="mt-2">
              Your trade runs through a smart contract that holds nothing between transactions.
              After the swap it counts the shares your tokens are worth and cancels the whole
              transaction if they are below your minimum. Because the check happens on the chain, it
              does not depend on Tally, on the route or on a promise.
            </p>
            <h3>What it does not promise</h3>
            <p className="mt-2">
              It cannot make a stock&apos;s price go up, and it does not cover the failed
              transaction&apos;s network fee, a few cents. It protects you from receiving fewer
              shares than you were shown, not from the stock falling. It has not been independently
              audited, so use small amounts while that is true. The technical details are in the{" "}
              <a className="link-text" href={DOCS_URL} target="_blank" rel="noreferrer">
                developer docs
              </a>
              .
            </p>
          </section>

          <section id="fees">
            <h2>Fees and limits</h2>
            <h3 id="how-fee">What you pay</h3>
            <ul className="mt-2 grid list-disc gap-2 pl-6 text-fg2 leading-7">
              <li>
                Tally adds no fee, for now. You pay the network fee, usually two to five cents, and
                the issuer&apos;s spread is already inside the price.
              </li>
              <li>The minimum purchase is $6, and the minimum sale is $5.</li>
              <li>
                A trade that is cancelled by the guarantee costs only its network fee. Your USDT
                stays in your wallet.
              </li>
            </ul>
          </section>

          <section id="radar">
            <h2>Reading Radar</h2>
            <p className="mt-3">
              Radar gives every token a grade from A to F and tells you why. It exists because a
              token can be listed and quoted, yet have no real market behind it.
            </p>
            <h3 id="how-radar">What the grade looks at</h3>
            <p className="mt-2">
              Whether the share multiplier agrees across sources, whether the price is close to the
              US price, how much it really trades, whether the issuer has paused it, and whether the
              issuer&apos;s own reserve report is recent. Every point taken off is shown with its
              reason.
            </p>
            <h3 id="how-liquidity">Liquid and Low Liquidity</h3>
            <p className="mt-2">
              <b>Liquid</b> means grade A or B: good trading and no data problems found.{" "}
              <b>Low Liquidity</b> means C to F: something looked thin or inconsistent, and the
              reasons are listed so you can judge for yourself.
            </p>
            <h3 id="how-not-tradable">Not Tradable</h3>
            <p className="mt-2">
              A token that traded under $1,000 in the last 24 hours on BNB Chain has no real market.
              Its price can be stale by days, and a buy could fill far from the price you see. Tally
              marks it Not Tradable and does not let you buy it.
            </p>
            <h3 id="how-grades">How a grade is made</h3>
            <p className="mt-2">{GRADE_INTRO}</p>
            <ul className="m-0 mt-3 grid list-none gap-2 p-0">
              {GRADE_RULES.map(([h, b]) => (
                <li key={h} className="panel p-3">
                  <p className="font-semibold text-fg">{h}</p>
                  <p className="mt-0.5 text-[15px]">{b}</p>
                </li>
              ))}
            </ul>
            <p className="t-meta mt-3">{GRADE_BANDS}</p>
            <p className="mt-3">
              A check that cannot run is shown as unknown, never as passed. A grade is never changed
              silently.
            </p>
          </section>

          <section id="portfolio">
            <h2>Your portfolio</h2>
            <h3 id="how-portfolio">Holdings from different issuers, counted as one</h3>
            <p className="mt-2">
              Your Portfolio adds up what you hold across issuers in shares, so 1.2 shares from Ondo
              and 0.5 from bStock read as 1.7 shares, not two confusing token balances. You can
              paste any wallet address to look at it too, because the data is public.
            </p>
            <p className="mt-3">
              Your statement lists your activity and shows a PnL only where Tally can support it.
              When it cannot, it says unknown and never shows a guess. You can download it as a CSV
              or PDF.
            </p>
            <p className="mt-3">
              If you hold fewer than three stocks, Portfolio suggests a few more that can be traded
              and have good liquidity right now. It is the same short list for everyone, shown in a
              different order, and it is not advice.
            </p>
          </section>

          <section id="sell">
            <h2>Selling and Migrate</h2>
            <p className="mt-3">
              <b>Selling</b> turns a stock token into USDT. The sale sheet shows the least USDT you
              will receive. The sale guarantee is the router&apos;s minimum, not the share guarantee
              that buys have.
            </p>
            <p className="mt-3">
              <b>Migrate</b> moves a holding to the other issuer of the same stock, for example
              NVDAB to NVDAon. It is two transactions you confirm one at a time: a sale, then a
              purchase. The price can move between them, and your USDT waits in your wallet if you
              pause. When it finishes, one receipt shows what you gave up and what you received, in
              tokens, shares and dollars, with a link you can share.
            </p>
            <p className="mt-3">
              Ondo tokens only trade while Ondo&apos;s market is open. Outside those hours Tally
              turns the button off before anything is sold, with the reason.
            </p>
          </section>

          <section id="guardian">
            <h2>Guardian alerts</h2>
            <p className="mt-3">
              Guardian watches the tokens in your wallet and alerts you about certain issues, like a
              pause, a change in your share count or a drop in grade. Alerts are private to you, so
              you need to sign in to start receiving them. Link your Telegram with a short code, and
              you can switch alerts off or set quiet hours any time.
            </p>
          </section>

          <section id="pies">
            <h2>Baskets</h2>
            <p className="mt-3">
              A basket is a set of stocks bought together. You enter a budget and how much of it
              goes to each stock, and Tally buys them one after another for you. Each stock is its
              own guaranteed purchase that you confirm in your wallet. If one fails, Tally stops and
              shows exactly what happened. You can continue with the rest.
            </p>
          </section>

          <section id="limits">
            <h2>What can go wrong</h2>
            <ul className="mt-3 grid list-disc gap-2 pl-6 text-fg2 leading-7">
              <li>The stock&apos;s price can fall. The guarantee does not cover that.</li>
              <li>
                A token can be paused by its issuer. Tally will not let you buy a paused token.
              </li>
              <li>
                A price can change between the quote and your confirmation. That is what the minimum
                is for: the trade is cancelled instead of filling worse.
              </li>
              <li>
                Prices on BNB Chain can differ from US prices, especially when US markets are
                closed.
              </li>
              <li>Only send funds on BNB Smart Chain. Other networks cannot be recovered.</li>
              <li>
                Tokenized stocks are not the underlying shares and may not be available in your
                country.
              </li>
            </ul>
            <p className="mt-3">
              See{" "}
              <a className="link-text" href="/docs#disclaimer">
                availability and disclaimer
              </a>
              .
            </p>
          </section>

          <section id="more">
            <h2>Learn more</h2>
            <p className="mt-3">
              Curious how Tally was built, how the contract works or how the data is checked? The
              developer documentation covers the architecture, the smart contracts, the challenges
              we hit and the roadmap.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <ButtonLink href={DOCS_URL} target="_blank" rel="noreferrer">
                Developer docs <ArrowRight size={16} aria-hidden />
              </ButtonLink>
              <ButtonLink href="/trade" variant="glassy">
                Compare a stock
              </ButtonLink>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
