import { AlertTriangle, ExternalLink, ShieldCheck } from "lucide-react";
import {
  HeroQuoteCard,
  LandingQuote,
  ComparisonPreview,
  RecentFills,
  TickerStrip,
  UnitTrapCard,
} from "@/components/landing/live";
import { ButtonLink } from "@/components/motion/button";
import { Reveal } from "@/components/reveal";
import { SHAREGUARD_DEPLOYED } from "@tally/config";

const GUARD_URL = `https://bscscan.com/address/${SHAREGUARD_DEPLOYED}`;
const TX_ONDO =
  "https://bscscan.com/tx/0x55ec244764dae2778357a7a446f5ec95de03cf2243fbff3ea1f3b4458a22e11a";
const TX_BSTOCK =
  "https://bscscan.com/tx/0xb678802dfb1dfa6e1206ac01fdf79d18181d5d61bab23d307b7ea059abc39a8e";

const FAQ: [string, string][] = [
  [
    "Is one token one share?",
    "Not always. Ondo's NFLX token is ten shares, bStock's is one. Tally always shows you shares, so prices compare fairly.",
  ],
  [
    "What does ShareGuard do?",
    "It's a contract that buys for you and checks how many shares you received. If you'd get fewer than the minimum you were shown, the whole trade is cancelled and your USDT stays with you.",
  ],
  [
    "Do I need to know crypto?",
    "No. Sign in with your email, add USDT and a few cents of BNB on the BNB Smart Chain network, and buy. We explain each step.",
  ],
  [
    "What does it cost?",
    "Tally adds no fee. You pay the network fee, about two to five cents, and the price already includes the issuers' spread. The minimum buy is $6.",
  ],
  [
    "Who holds my money?",
    "You do. Everything is signed in your own wallet. Tally never holds your funds or keys.",
  ],
  [
    "Where is it available?",
    "Not in the US, Canada, the UK, Japan, the Netherlands, Iran, Cuba, North Korea, Syria, Crimea, Donetsk or Luhansk. Not investment advice.",
  ],
];

export default function Home() {
  return (
    <main id="main">
      <LandingQuote>
        <section className="wrap pt-12 min-[981px]:pt-20" aria-labelledby="hero-title">
          <div className="grid grid-cols-1 items-center gap-12 min-[981px]:grid-cols-[1.05fr_.95fr]">
            <div className="min-w-0">
              <p className="eyebrow glass !rounded-full blur-in">
                <span className="dot-live" aria-hidden />
                <span>
                  Live on BNB Chain · <b>Ondo · bStocks · xStocks</b>
                </span>
              </p>
              <h1 id="hero-title" className="t-display mt-6">
                <span
                  className="blur-in blur-in-word"
                  style={{ "--d": "60ms" } as React.CSSProperties}
                >
                  Buy <span className="fade-text">shares,</span>
                </span>
                <br />
                <span
                  className="blur-in blur-in-word"
                  style={{ "--d": "140ms" } as React.CSSProperties}
                >
                  not tokens.
                </span>
                <br />
                <span
                  className="blur-in blur-in-word dim-text"
                  style={{ "--d": "220ms" } as React.CSSProperties}
                >
                  Best price, guaranteed.
                </span>
              </h1>
              <p className="t-lead mt-6 max-w-[52ch]">
                Tally quotes the same stock from every issuer in real share units, routes your buy
                to the best true price, and settles through ShareGuard: if you would receive fewer
                shares than promised, nothing happens.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink href="/trade/NVDA">Get a quote</ButtonLink>
                <ButtonLink href="#shield" variant="glassy">
                  See the trap
                </ButtonLink>
              </div>
              <p className="t-meta mt-4">
                <span className="limit-chip">Min $6</span>
              </p>
            </div>

            <div
              className="relative mx-auto grid w-full max-w-[460px] min-w-0 gap-4 min-[981px]:max-w-none"
              aria-label="Live examples"
            >
              <span
                aria-hidden
                className="shape sphere drift absolute -right-6 -top-10 z-0 h-24 w-24 opacity-90"
              />
              <span
                aria-hidden
                className="shape ring float absolute -bottom-14 right-8 z-0 h-24 w-24 opacity-80"
              />
              <HeroQuoteCard />
              <RecentFills />
              <div className="gcard relative z-10">
                <p className="t-meta">The unit trap</p>
                <p className="mt-1 text-lg font-semibold tracking-tight">
                  1 Ondo NFLX token = <span className="num text-amber">10</span> shares
                </p>
                <p className="t-meta mt-1">bStock and xStocks NFLX = 1 share per token.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="wrap mt-16" aria-label="Tickers">
          <TickerStrip />
        </section>

        <section id="compare" className="wrap section-pad scroll-mt-24">
          <div className="grid grid-cols-1 gap-10 min-[981px]:grid-cols-[.9fr_1.1fr]">
            <Reveal className="min-w-0">
              <p className="t-kicker">One stock, three tokens</p>
              <h2 className="t-h2 mt-3">The same ticker is not the same amount of stock.</h2>
              <p className="t-lead mt-3 max-w-[48ch]">
                Issuers define a token differently, so raw prices mislead. Tally converts everything
                into shares first.
              </p>
              <div className="mt-6">
                <UnitTrapCard />
              </div>
            </Reveal>
            <Reveal className="min-w-0" delay={80}>
              <p className="t-kicker">Live comparison · $6 of NVDA</p>
              <h2 className="t-h2 mt-3">Compared in shares, right now.</h2>
              <ComparisonPreview />
            </Reveal>
          </div>
        </section>

        <section id="guard" className="wrap section-pad scroll-mt-24">
          <Reveal>
            <div className="glass p-6 min-[561px]:p-8">
              <p className="t-kicker">ShareGuard</p>
              <h2 className="t-h2 mt-3">Guaranteed in shares, on-chain.</h2>
              <ol className="mt-6 grid list-none grid-cols-1 gap-3 p-0 min-[761px]:grid-cols-3">
                {[
                  ["1 · Quote", "We quote every issuer in shares and show the minimum you'll get."],
                  [
                    "2 · Guard",
                    "ShareGuard buys through an allow-listed route and counts the shares it received.",
                  ],
                  [
                    "3 · Shares",
                    "Enough shares: they go to your wallet. Too few: the whole trade is cancelled.",
                  ],
                ].map(([h, b]) => (
                  <li key={h} className="panel p-5">
                    <p className="flex items-center gap-2 font-semibold">
                      <ShieldCheck size={16} aria-hidden /> {h}
                    </p>
                    <p className="mt-1 text-[14px] text-fg2">{b}</p>
                  </li>
                ))}
              </ol>
              <p className="t-meta mt-5 flex flex-wrap gap-x-4 gap-y-2">
                <a
                  className="inline-flex min-h-[44px] items-center gap-1.5 text-blue"
                  href={GUARD_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  ShareGuard on BscScan <ExternalLink size={12} aria-hidden />
                </a>
                <a
                  className="inline-flex min-h-[44px] items-center gap-1.5 text-blue"
                  href={TX_ONDO}
                  target="_blank"
                  rel="noreferrer"
                >
                  Live Ondo buy <ExternalLink size={12} aria-hidden />
                </a>
                <a
                  className="inline-flex min-h-[44px] items-center gap-1.5 text-blue"
                  href={TX_BSTOCK}
                  target="_blank"
                  rel="noreferrer"
                >
                  Live bStock buy <ExternalLink size={12} aria-hidden />
                </a>
              </p>
            </div>
          </Reveal>
        </section>

        <section id="shield" className="wrap section-pad scroll-mt-24">
          <Reveal>
            <p className="t-kicker">Trap Shield</p>
            <h2 className="t-h2 mt-3">We caught these so you don&apos;t buy them.</h2>
            <ul className="mt-6 grid list-none grid-cols-1 gap-3 p-0 min-[761px]:grid-cols-3">
              {[
                [
                  "Ghost market",
                  "xStocks NVDA had $52 of trading in 24 hours on BNB Chain. Its price can be stale by 90% or more.",
                  "badge-red",
                ],
                [
                  "Unit mismatch",
                  "Ondo NFLX is ten shares per token. Compare per token and you'd see a fake 899% gap.",
                  "badge-amber",
                ],
                [
                  "Data disagrees",
                  "One xStocks token has three different share counts depending on where you read it.",
                  "badge-amber",
                ],
              ].map(([h, b, tone]) => (
                <li key={h} className="glass p-5">
                  <span className={`badge ${tone}`}>
                    <AlertTriangle size={12} aria-hidden /> {h}
                  </span>
                  <p className="mt-3 text-[14.5px] text-fg2">{b}</p>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        <section id="faq" className="wrap section-pad scroll-mt-24">
          <div className="grid grid-cols-1 gap-10 min-[981px]:grid-cols-[.8fr_1.2fr]">
            <Reveal>
              <p className="t-kicker">FAQ</p>
              <h2 className="t-h2 mt-3">Questions, answered plainly.</h2>
            </Reveal>
            <Reveal delay={80}>
              <div className="grid gap-3">
                {FAQ.map(([q, a]) => (
                  <details key={q} className="panel group p-4 open:bg-white/[0.05]">
                    <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 font-semibold [&::-webkit-details-marker]:hidden">
                      {q}
                      <span
                        aria-hidden
                        className="grid h-9 w-9 flex-none place-items-center rounded-full bg-white/[0.08] transition-transform group-open:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    <p className="mt-2 text-[14.5px] text-fg2">{a}</p>
                  </details>
                ))}
              </div>
            </Reveal>
          </div>
          <p id="disclaimer" className="t-meta mt-10">
            Not investment advice. Tally compares and executes at your instruction; it doesn&apos;t
            recommend what to buy. Not available in restricted regions.
          </p>
        </section>
      </LandingQuote>
    </main>
  );
}
