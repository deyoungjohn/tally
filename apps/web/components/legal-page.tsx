import Link from "next/link";
import { LEGAL, type LegalSection } from "@/lib/legal-content";

/** One legal document: a title, the date, a short intro and numbered sections, with a contents list on wide screens. */
export function LegalPage({
  kicker,
  title,
  intro,
  sections,
  other,
}: {
  kicker: string;
  title: string;
  intro: string;
  sections: LegalSection[];
  other: { href: string; label: string };
}) {
  return (
    <main id="main" className="wrap pb-24 pt-10 min-[561px]:pt-14">
      <p className="t-kicker">{kicker}</p>
      <h1 className="t-h2 mt-3">{title}</h1>
      <p className="t-meta mt-2">Last updated {LEGAL.updated}</p>
      <p className="t-lead mt-4 max-w-[62ch]">{intro}</p>
      <div className="mt-8 grid grid-cols-1 gap-8 min-[981px]:grid-cols-[260px_minmax(0,1fr)]">
        <nav
          aria-label="On this page"
          className="min-[981px]:sticky min-[981px]:top-24 min-[981px]:self-start"
        >
          <ul className="m-0 grid list-none gap-1 p-0">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="nav-link block hover:bg-[var(--hl)]">
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="grid min-w-0 gap-6 [&_h2]:t-h3 [&_p]:text-fg2 [&_p]:leading-7 [&_section]:glass [&_section]:scroll-mt-28 [&_section]:p-6 min-[561px]:[&_section]:p-8">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} data-testid={`legal-${s.id}`}>
              <h2>
                {i + 1}. {s.title}
              </h2>
              {s.paragraphs?.map((p) => (
                <p key={p} className="mt-3">
                  {p}
                </p>
              ))}
              {s.bullets ? (
                <ul className="mt-3 grid list-disc gap-2 pl-6 leading-7 text-fg2">
                  {s.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
          <p className="t-meta" data-testid="legal-contact-line">
            Contact: {LEGAL.owner} through{" "}
            <a className="link-text" href={LEGAL.contactHref} target="_blank" rel="noreferrer">
              {LEGAL.contactLabel}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            . See also the{" "}
            <Link className="link-text" href={other.href}>
              {other.label}
            </Link>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
