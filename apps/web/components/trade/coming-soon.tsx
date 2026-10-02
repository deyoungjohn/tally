import { Lock } from "lucide-react";

/** Disabled features, honestly labelled. Nothing here is clickable. */
export function ComingSoon({ items, title = "Coming soon" }: { items: string[]; title?: string }) {
  return (
    <section className="panel p-4" aria-label={title}>
      <p className="t-kicker">{title}</p>
      <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
        {items.map((i) => (
          <li key={i}>
            <span className="badge" aria-disabled="true">
              <Lock size={11} aria-hidden /> {i} <span className="text-fg3">· Soon</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
