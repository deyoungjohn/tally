import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { SHAREGUARD_DEPLOYED } from "@tally/config";

export const metadata: Metadata = {
  title: "Docs | Tally",
  description: "Contract addresses, on-chain proof and developer documentation for Tally.",
};

const DOCS_URL = "https://docs.tallyprotocol.xyz";

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
      className="inline-flex min-h-[44px] items-center gap-1.5 link-text"
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
  ["developers", "Developer docs"],
  ["contracts", "Contracts and proof"],
  ["disclaimer", "Availability and disclaimer"],
] as const;

export default function Docs() {
  return (
    <main id="main" className="wrap pb-24 pt-10 min-[561px]:pt-14">
      <p className="t-kicker">Docs</p>
      <h1 className="t-h2 mt-3">Contracts, proof and the developer docs.</h1>
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
        <div className="grid min-w-0 gap-6 [&_h2]:t-h3 [&_p]:text-fg2 [&_p]:leading-7 [&_section]:glass [&_section]:scroll-mt-28 [&_section]:p-6 min-[561px]:[&_section]:p-8">
          <section id="developers">
            <h2>Developer documentation</h2>
            <p className="mt-3">
              How Tally was built, the architecture, the smart contract, the product modules, the
              challenges we hit and the roadmap are written up for developers in the docs. Looking
              for the plain-language guide instead? Read{" "}
              <a className="link-text" href="/how-it-works">
                How it works
              </a>
              .
            </p>
            <p className="mt-3">
              <Ext href={DOCS_URL}>docs.tallyprotocol.xyz</Ext>
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
