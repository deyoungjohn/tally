import { Check } from "lucide-react";
import { ButtonLink } from "@/components/motion/button";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Reveal } from "@/components/reveal";

/**
 * M0 landing skeleton (DESIGN.md §5.1, sections 1-2 + a placeholder for the rest).
 * Numbers below are RECORDED live fills from 2026-10-01 (IDEAS.md F6/F7), not live data.
 * M3 replaces them with the engine's output.
 */
export default function Home() {
  return (
    <main id="main">
      <section className="wrap pt-12 min-[981px]:pt-20" aria-labelledby="hero-title">
        <div className="grid items-center gap-12 min-[981px]:grid-cols-[1.05fr_.95fr]">
          <div>
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
              Tally quotes the same stock from every issuer in real share units, routes your buy to
              the best true price, and settles through ShareGuard: if you would receive fewer shares
              than promised, nothing happens.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="#compare">Get a quote</ButtonLink>
              <ButtonLink href="#shield" variant="glassy">
                See the trap
              </ButtonLink>
            </div>
            <p className="t-meta mt-4">
              <span className="limit-chip">Min $6</span>
            </p>
          </div>

          <div
            className="relative mx-auto grid w-full max-w-[460px] gap-4 min-[981px]:max-w-none"
            aria-label="Examples from recorded trades"
          >
            <span
              aria-hidden
              className="shape sphere drift absolute -right-6 -top-10 z-0 h-24 w-24 opacity-90"
            />
            <span
              aria-hidden
              className="shape ring float absolute -bottom-14 right-8 z-0 h-24 w-24 opacity-80"
            />
            <div className="gcard relative z-10">
              <p className="t-meta">NVDA · Ondo · recorded live buy</p>
              <p className="t-big mt-2">
                <AnimatedNumber value={0.026137} decimals={4} />{" "}
                <span className="text-2xl text-fg2">shares</span>
              </p>
              <p className="mt-2 text-sm text-fg2">
                <span className="num text-up">▼ −0.12%</span> vs US price · 229.56 USDT per share
              </p>
            </div>
            <div className="gcard relative z-10 ml-6 min-[981px]:ml-16">
              <div className="flex items-center gap-3">
                <span
                  className="grid h-6 w-6 place-items-center rounded-full bg-up/20 text-up"
                  aria-hidden
                >
                  <Check size={14} />
                </span>
                <p className="text-sm font-semibold">Shares delivered</p>
              </div>
              <p className="t-meta mt-2">Checked on-chain by ShareGuard in shares, not tokens.</p>
            </div>
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

      {[
        "compare|One stock, three tokens|The live comparison (shares you get, price per share, real network fee, integrity grade) arrives in M3.",
        "guard|Guaranteed in shares, on-chain|ShareGuard checks the shares you receive and reverts if they fall short. Arrives with M2.",
        "shield|Trap Shield|The tokens that would mislead a naive tool: unit mismatches, ghost markets, disagreeing data. Arrives in M4.",
        "faq|FAQ|Answers arrive with the full landing page in M3.",
      ].map((s) => {
        const [id, title, body] = s.split("|");
        return (
          <section key={id} id={id} className="wrap section-pad scroll-mt-24">
            <Reveal>
              <div className="glass p-6 min-[561px]:p-8">
                <p className="t-kicker">Coming next</p>
                <h2 className="t-h2 mt-3">{title}</h2>
                <p className="t-lead mt-3 max-w-[60ch]">{body}</p>
              </div>
            </Reveal>
          </section>
        );
      })}
    </main>
  );
}
