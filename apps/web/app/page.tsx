import {
  ArrowLeftRight,
  ArrowRight,
  Bell,
  Eye,
  FileText,
  PieChart,
  Radar as RadarIcon,
  ShieldCheck,
  ShoppingBasket,
} from "lucide-react";
import {
  HomeComparison,
  HomePortfolioPreview,
  HomeRadarPreview,
  HomeTradeCard,
  UnitTrapCard,
} from "@/components/home/parts";
import { HeroActions } from "@/components/home/hero-actions";
import { ButtonLink } from "@/components/motion/button";
import { Reveal } from "@/components/reveal";
import { HomeFaq } from "@/components/home/faq";
import { HeroLine, HeroPanels, HeroStage } from "@/components/home/hero-stage";
import { moduleFlags } from "@/lib/flags";
import { LearnMore } from "@/components/learn-more";

/** One screen per feature on a 16" desktop: Trade, Portfolio, Radar, the rest of the app, then the FAQ. */
const SCREEN =
  "wrap flex scroll-mt-24 flex-col justify-center py-14 min-[981px]:min-h-[calc(100svh-96px)] min-[981px]:py-10";

export default function Home() {
  const flags = moduleFlags();
  return (
    <main id="main">
      <section className={SCREEN} aria-labelledby="hero-title">
        <HeroStage>
          <div className="grid grid-cols-1 items-center gap-12 min-[981px]:grid-cols-[1.05fr_.95fr]">
            <div className="min-w-0">
              <p className="eyebrow glass !rounded-full blur-in">
                <span>
                  Live on BNB Chain · <b>Ondo · bStocks · xStocks</b>
                </span>
              </p>
              <h1 id="hero-title" className="t-display mt-6">
                <span
                  className="blur-in blur-in-word"
                  style={{ "--d": "60ms" } as React.CSSProperties}
                >
                  Tally, the <span className="fade-text">everything app</span>
                </span>{" "}
                <br />
                <span
                  className="blur-in blur-in-word dim-text"
                  style={{ "--d": "160ms" } as React.CSSProperties}
                >
                  for tokenized stocks on BSC.
                </span>
              </h1>
              <p
                className="blur-in mt-5 text-[clamp(20px,2.6vw,28px)] font-semibold leading-[1.25] tracking-[-0.02em] text-[var(--orange-text)]"
                style={{ "--d": "260ms" } as React.CSSProperties}
              >
                <HeroLine />
              </p>
              <p className="t-lead mt-5 max-w-[54ch]">
                Trade, migrate, track and protect tokenized stocks in one place. Tally compares
                every issuer in share units, buys from the best one, and reverts any trade that
                would give you fewer shares than promised.
              </p>
              <HeroActions />
            </div>
            <div className="relative mx-auto w-full max-w-[520px] min-w-0 min-[981px]:max-w-none">
              <span
                aria-hidden
                className="shape sphere drift absolute -right-6 -top-10 z-0 h-20 w-20 opacity-90"
              />
              <span
                aria-hidden
                className="shape ring float absolute -bottom-16 -right-5 z-0 h-20 w-20 opacity-60"
              />
              <div className="relative z-10">
                <HeroPanels trade={<HomeTradeCard compact />} />
              </div>
            </div>
          </div>
        </HeroStage>
      </section>

      <section id="more" className={SCREEN} aria-labelledby="more-title">
        <Reveal>
          <div className="mx-auto w-full max-w-[980px]">
            <div className="text-center">
              <h2 id="more-title" className="t-h2">
                You can do many things with tokenized stocks on Tally
              </h2>
              <p className="t-lead mx-auto mt-3 max-w-[56ch]">
                Buying a tokenized stock is just the beginning. With Tally, you can migrate your
                holdings between issuers, buy whole stock baskets, be alerted about the tokens you
                hold and get your wallet statement in one click.
              </p>
            </div>
            <ul className="m-0 mt-10 grid list-none grid-cols-1 gap-4 p-0 min-[761px]:grid-cols-2">
              {(
                [
                  [
                    ArrowLeftRight,
                    "Migrate",
                    "Move a holding from one issuer to another in two confirmed steps. A receipt compares the shares you gave up with the shares you received.",
                    "/portfolio",
                    "Open Portfolio",
                  ],
                  [
                    ShoppingBasket,
                    "Baskets",
                    "Pick a basket, set a budget and how much goes to each stock, and Tally buys them one after another, each with its own guaranteed minimum.",
                    "/pies",
                    "Open Baskets",
                  ],
                  [
                    Bell,
                    "Guardian",
                    "Alerts about the tokens you hold: a trading pause, a change in shares per token or a drop in liquidity grade, sent to you on Telegram.",
                    "/guardian",
                    "Open Guardian",
                  ],
                  [
                    FileText,
                    "Statements",
                    "Everything you bought and sold, counted in shares, with a statement you can download as a PDF or a CSV.",
                    "/portfolio",
                    "Open Portfolio",
                  ],
                ] as const
              )
                .filter(([, , , href]) =>
                  href === "/pies" ? flags.pies : href === "/guardian" ? flags.guardian : true,
                )
                .map(([Icon, h, b, href, cta]) => (
                  <li key={h} className="panel flex min-w-0 flex-col gap-3 p-5">
                    <p className="flex items-center gap-2 text-[18px] font-bold">
                      <Icon size={18} aria-hidden /> {h}
                    </p>
                    <p className="flex-1 text-[15px] text-fg2">{b}</p>
                    <div>
                      <ButtonLink href={href} variant="glassy">
                        {cta} <ArrowRight size={16} aria-hidden />
                      </ButtonLink>
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        </Reveal>
      </section>

      <section id="trade" className={SCREEN} aria-labelledby="trade-title">
        <Reveal>
          <div className="grid grid-cols-1 gap-10 min-[981px]:grid-cols-[.9fr_1.1fr]">
            <div className="min-w-0">
              <p className="t-kicker flex items-center gap-2">
                <Eye size={14} aria-hidden /> Trade
              </p>
              <h2 id="trade-title" className="t-h2 mt-3">
                One stock, three issuers, one fair price per share.
              </h2>
              <p className="t-lead mt-3 max-w-[50ch]">
                The same ticker is not the same amount of stock. Issuers define a token differently,
                so raw prices mislead. Tally converts everything into unit shares first, then ranks
                the issuers by what you actually pay, network fee included.{" "}
                <LearnMore concept="shares" />
              </p>
              <ul className="m-0 mt-6 grid list-none gap-3 p-0">
                {[
                  [
                    "Shares you get",
                    "Every quote is in share units, with the price per share and the premium over the US price.",
                  ],
                  ["The real network fee", "Estimated from the route's real cost."],
                  [
                    "Cheapest right now",
                    "Quotes refresh every 10 seconds and the best issuer is marked.",
                  ],
                ].map(([h, b]) => (
                  <li key={h} className="panel p-4">
                    <p className="font-semibold">{h}</p>
                    <p className="mt-1 text-[15px] text-fg2">{b}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <UnitTrapCard />
              </div>
            </div>
            <div className="min-w-0">
              <HomeComparison />
              <div className="mt-8">
                <ButtonLink href="/trade">
                  Open Trade <ArrowRight size={16} aria-hidden />
                </ButtonLink>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      <section id="portfolio" className={SCREEN} aria-labelledby="portfolio-title">
        <Reveal>
          <div className="grid grid-cols-1 gap-10 min-[981px]:grid-cols-[.9fr_1.1fr]">
            <div className="min-w-0">
              <p className="t-kicker flex items-center gap-2">
                <PieChart size={14} aria-hidden /> Portfolio
              </p>
              <h2 id="portfolio-title" className="t-h2 mt-3">
                Your holdings, counted in shares.
              </h2>
              <p className="t-lead mt-3 max-w-[50ch]">
                Tokens from different issuers add up in share units, so you never have to do the
                maths yourself. <LearnMore concept="portfolio" />
              </p>
              <ul className="m-0 mt-6 grid list-none gap-3 p-0">
                {[
                  [
                    "Across issuers",
                    "1.2 shares from Ondo and 0.5 from bStock read as 1.7 shares.",
                  ],
                  ["Value in dollars", "At the current US price per share."],
                ].map(([h, b]) => (
                  <li key={h} className="panel p-4">
                    <p className="font-semibold">{h}</p>
                    <p className="mt-1 text-[15px] text-fg2">{b}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <ButtonLink href="/portfolio">
                  Open Portfolio <ArrowRight size={16} aria-hidden />
                </ButtonLink>
              </div>
            </div>
            <div className="min-w-0">
              <HomePortfolioPreview />
            </div>
          </div>
        </Reveal>
      </section>

      <section id="radar" className={SCREEN} aria-labelledby="radar-title">
        <Reveal>
          <div className="grid grid-cols-1 gap-10 min-[981px]:grid-cols-[.9fr_1.1fr]">
            <div className="min-w-0">
              <p className="t-kicker flex items-center gap-2">
                <RadarIcon size={14} aria-hidden /> Radar
              </p>
              <h2 id="radar-title" className="t-h2 mt-3">
                We catch the tokens that would mislead you.
              </h2>
              <p className="t-lead mt-3 max-w-[50ch]">
                Markets nobody trades, tokens that are ten shares each, data that disagrees with
                itself, paused assets. Radar grades every token A to F and says why, in plain words.{" "}
                <LearnMore concept="radar" />
              </p>
              <ul className="m-0 mt-6 grid list-none gap-3 p-0">
                {[
                  [
                    "Not Tradable",
                    "Under $1,000 traded in a day means stale prices, so Tally won't let you buy.",
                  ],
                  [
                    "Unit traps",
                    "One token can be ten shares, which makes naive comparisons wrong by 899%.",
                  ],
                  [
                    "Minimum-shares guarantee",
                    "Before any buy, Tally checks the shares you'd receive and cancels the trade if they fall short.",
                  ],
                ].map(([h, b]) => (
                  <li key={h} className="panel p-4">
                    <p className="flex items-center gap-2 font-semibold">
                      {h === "Minimum-shares guarantee" ? (
                        <ShieldCheck size={15} aria-hidden />
                      ) : null}
                      {h}
                    </p>
                    <p className="mt-1 text-[15px] text-fg2">{b}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <ButtonLink href="/radar">
                  Open Radar <ArrowRight size={16} aria-hidden />
                </ButtonLink>
              </div>
            </div>
            <div className="min-w-0">
              <HomeRadarPreview />
            </div>
          </div>
        </Reveal>
      </section>

      <section id="faq" className={SCREEN} aria-labelledby="faq-title">
        <Reveal>
          <div className="mx-auto grid w-full max-w-[760px] grid-cols-1 gap-8">
            <div className="text-center">
              <p className="t-kicker">FAQ</p>
              <h2 id="faq-title" className="t-h2 mt-3">
                Answers to your burning questions.
              </h2>
              <p className="t-meta mx-auto mt-4 max-w-[60ch]">
                Tally compares and executes at your instruction; it doesn&apos;t recommend what to
                buy.
              </p>
            </div>
            <div className="min-w-0">
              <HomeFaq />
            </div>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
