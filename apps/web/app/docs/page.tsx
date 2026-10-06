import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { SHAREGUARD_DEPLOYED } from "@tally/config";
import { CONCEPTS } from "@/lib/concepts";

export const metadata: Metadata = { title: "Docs: how Tally works · Tally" };

const BSCSCAN = "https://bscscan.com";
const GUARD = SHAREGUARD_DEPLOYED;
const TX = [
  [
    "Ondo (NVDAon), signed feed update",
    "0x55ec244764dae2778357a7a446f5ec95de03cf2243fbff3ea1f3b4458a22e11a",
    "6 USDT → 0.025704894 shares",
  ],
  [
    "bStock (NVDAB)",
    "0xb678802dfb1dfa6e1206ac01fdf79d18181d5d61bab23d307b7ea059abc39a8e",
    "6 USDT → 0.025674701 shares",
  ],
] as const;

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      className="inline-flex min-h-[44px] items-center gap-1.5 text-blue"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children} <ExternalLink size={12} aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

const NAV = [
  ["tokenized", "What you are buying"],
  ["how", "How a buy works"],
  ["guarantee", "The guarantee"],
  ["fees", "Fees and limits"],
  ["data", "Where the data comes from"],
  ["contracts", "Contracts and proof"],
  ["disclaimer", "Availability and disclaimer"],
] as const;

export default function Docs() {
  return (
    <main id="main" className="wrap pb-24 pt-10 min-[561px]:pt-14">
      <p className="t-kicker">Docs</p>
      <h1 className="t-h2 mt-3">How Tally works.</h1>
      <div className="mt-8 grid grid-cols-1 gap-8 min-[981px]:grid-cols-[240px_minmax(0,1fr)]">
        <nav
          aria-label="On this page"
          className="min-[981px]:sticky min-[981px]:top-24 min-[981px]:self-start"
        >
          <ul className="m-0 grid list-none gap-1 p-0">
            {NAV.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="nav-link block hover:bg-white/[0.06]">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="grid min-w-0 gap-6 [&_h2]:t-h3 [&_p]:text-fg2 [&_p]:leading-7 [&_section]:glass [&_section]:scroll-mt-28 [&_section]:p-6 min-[561px]:[&_section]:p-8">
          <section id="tokenized">
            <h2>What you are buying</h2>
            <p className="mt-3">
              Tokenized shares: tokens issued by Ondo and bStocks that follow a US stock&apos;s
              price on BNB Smart Chain. You do not own the underlying share and get no shareholder
              rights. Each issuer&apos;s own terms apply. Tally is a secondary-market comparison and
              trading tool: it never mints or redeems tokens, and nothing here is investment advice.
            </p>
            <p className="mt-3">
              A token is not always one share. Ondo&apos;s NFLXon token is ten shares, bStock&apos;s
              NFLXB is one. Tally multiplies every token by its share multiplier so all quotes are
              in the same unit: shares.
            </p>
          </section>

          <section id="how">
            <h2>How a buy works</h2>
            <ol className="mt-3 grid list-decimal gap-2 pl-6 text-fg2 leading-7">
              <li>
                Tally quotes every issuer at the same moment, converts to shares and ranks them by
                price per share with the network fee included.
              </li>
              <li>
                You pick an amount (from $6) and sign in. Your wallet is created with your email;
                you sign everything yourself.
              </li>
              <li>
                If you have not allowed Tally to spend that exact USDT amount yet, you approve
                exactly that amount, never unlimited.
              </li>
              <li>
                Tally builds a fresh quote, estimates the network fee, and simulates the trade at
                the exact gas limit it will send. If the simulation fails you are not asked to sign.
              </li>
              <li>
                You see the minimum shares you will receive, confirm, and sign. The receipt shows
                the shares delivered, read from the on-chain event.
              </li>
            </ol>
          </section>

          <section id="concepts">
            <h2>The reasoning behind each number</h2>
            <p className="mt-3">
              The short explanations on the site (the “Learn more” links) end here. The full
              write-ups, with references, are being written.
            </p>
            <div className="mt-4 grid gap-4">
              {Object.values(CONCEPTS).map((c) => (
                <div key={c.id} id={`how-${c.id}`} className="scroll-mt-28">
                  <h3 className="font-semibold text-fg">{c.title}</h3>
                  {c.paragraphs.map((t) => (
                    <p key={t} className="mt-2">
                      {t}
                    </p>
                  ))}
                  <p className="t-meta mt-2">Full write-up with references: coming soon.</p>
                </div>
              ))}
            </div>
          </section>

          <section id="guarantee">
            <h2>The guarantee</h2>
            <p className="mt-3">
              The trade runs through a smart contract called ShareGuard that holds nothing between
              transactions. It buys through an allow-listed route, counts the shares your tokens are
              worth, and reverts the whole transaction if they are below your minimum. The route,
              the issuers&apos; pause checks and the Ondo share multiplier (a signed, bounded feed)
              are all enforced on-chain.
            </p>
            <p className="mt-3">
              ShareGuard v1 has not been independently audited. Test-size amounts only until it has
              been.
            </p>
          </section>

          <section id="fees">
            <h2>Fees and limits</h2>
            <ul className="mt-3 grid list-disc gap-2 pl-6 text-fg2 leading-7">
              <li>
                Tally adds no fee. You pay the BNB Smart Chain network fee, about 2 to 5 cents, and
                the issuer&apos;s spread inside the price.
              </li>
              <li>
                The minimum buy is $6 (Ondo requires $5 in dollars; USDT is worth slightly under
                $1).
              </li>
              <li>
                You need USDT and a few cents of BNB, both on BNB Smart Chain (BEP-20). Anything
                sent on another network is lost.
              </li>
              <li>
                Price tolerance defaults to 1%. It decides the minimum shares you are guaranteed.
              </li>
            </ul>
          </section>

          <section id="data">
            <h2>Where the data comes from</h2>
            <p className="mt-3">
              Quotes and routes come from the Binance Web3 API. Share multipliers come from the
              token contracts where they exist (bStocks, xStocks) and from the issuer data for Ondo,
              with a bounds check on every change. Integrity grades on Radar combine these sources
              and show every reason. If a source fails, Tally says so rather than guessing.
            </p>
          </section>

          <section id="contracts">
            <h2>Contracts and proof</h2>
            <dl className="mt-3">
              <div className="detail-row">
                <dt>ShareGuard v1 (BNB Smart Chain, verified)</dt>
                <dd className="mono text-[13.5px]">
                  <Ext href={`${BSCSCAN}/address/${GUARD}`}>{GUARD}</Ext>
                </dd>
              </div>
              <div className="detail-row">
                <dt>Route used for stock buys</dt>
                <dd className="mono text-[13.5px]">
                  <Ext href={`${BSCSCAN}/address/0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5`}>
                    0xB444…dDA5
                  </Ext>
                </dd>
              </div>
              <div className="detail-row">
                <dt>USDT</dt>
                <dd className="mono text-[13.5px]">
                  <Ext href={`${BSCSCAN}/address/0x55d398326f99059fF775485246999027B3197955`}>
                    0x55d3…7955
                  </Ext>
                </dd>
              </div>
            </dl>
            <h3 className="mt-6 font-semibold text-fg">Two live guarded buys (2026-10-02)</h3>
            <dl className="mt-1">
              {TX.map(([label, hash, what]) => (
                <div key={hash} className="detail-row">
                  <dt>
                    {label}
                    <span className="block text-[13.5px] text-fg3">{what}</span>
                  </dt>
                  <dd className="mono text-[13.5px]">
                    <Ext href={`${BSCSCAN}/tx/${hash}`}>
                      {hash.slice(0, 10)}…{hash.slice(-6)}
                    </Ext>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="disclaimer">
            <h2>Availability and disclaimer</h2>
            <p className="mt-3">
              Not available in the United States, Canada, the United Kingdom, Japan, the
              Netherlands, Iran, Cuba, North Korea, Syria, Crimea, Donetsk or Luhansk. Tokenized
              stocks are traded on the secondary market on BNB Smart Chain; you are responsible for
              complying with the laws that apply to you. Not investment advice.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
