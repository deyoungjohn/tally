import { Lock } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";

/** Disabled features, honestly labelled. Nothing here is clickable. An item can carry a short tooltip that says what it will do. */
export function ComingSoon({
  items,
  title = "Coming soon",
  tips,
}: {
  items: string[];
  title?: string;
  tips?: Record<string, string>;
}) {
  return (
    <section className="panel p-4" aria-label={title}>
      <p className="t-kicker">{title}</p>
      <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
        {items.map((i) => {
          const badge = (
            <span className="badge" aria-disabled="true">
              <Lock size={11} aria-hidden /> {i} <span className="text-fg3">· Soon</span>
            </span>
          );
          return <li key={i}>{tips?.[i] ? <Tip text={tips[i]}>{badge}</Tip> : badge}</li>;
        })}
      </ul>
    </section>
  );
}
