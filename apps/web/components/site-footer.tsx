import Link from "next/link";
import { Logo } from "./site-header";

const COLS = [
  {
    h: "Product",
    links: [
      ["Trade", "/trade"],
      ["Portfolio", "/portfolio"],
      ["Radar", "/radar"],
    ],
  },
  {
    h: "Learn",
    links: [
      ["How it works", "/how-it-works"],
      ["FAQ", "/#faq"],
      ["Docs", "https://docs.tallyprotocol.xyz"],
      ["Contracts and proof", "/docs#contracts"],
    ],
  },
  { h: "Community", links: [["GitHub", "https://github.com/deyoungjohn/tally"]] },
  {
    h: "Legal",
    links: [
      ["Terms of Use", "/terms"],
      ["Privacy Policy", "/privacy"],
      ["Disclaimer", "/docs#disclaimer"],
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="relative z-10 px-4 pb-10 pt-6">
      <div className="glass mx-auto max-w-[var(--w)] !rounded-[26px] p-6 min-[561px]:p-8">
        <div className="grid gap-8 min-[761px]:grid-cols-[1.2fr_repeat(4,1fr)]">
          <div>
            <Logo />
            <p className="mt-3 max-w-[28ch] text-sm text-fg2">
              Tokenized stocks, compared across every issuer on BNB Chain, at the best price.
            </p>
          </div>
          {COLS.map((c) => (
            <div key={c.h}>
              <h2 className="text-xs font-semibold uppercase tracking-[0.09em] text-fg3">{c.h}</h2>
              <ul className="mt-3 grid gap-2">
                {c.links.map(([label, href]) => (
                  <li key={label}>
                    <Link href={href} className="link-text text-sm">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p id="disclaimer" className="t-meta mt-8 border-t border-white/[0.06] pt-5">
          The services offered by Tally are not available in restricted regions. Tokenized stocks
          are traded on the secondary market on BNB Smart Chain; you are responsible for complying
          with the laws that apply to you.
        </p>
        <p className="t-meta mt-3" data-testid="copyright">
          © 2026 Tally Protocol. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
