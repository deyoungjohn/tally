import Link from "next/link";
import { notFound } from "next/navigation";
import { moduleFlags } from "@/lib/flags";

export const dynamic = "force-dynamic";
export default function DevPreviews() {
  if (process.env.NODE_ENV === "production" && process.env.TALLY_DEV_PREVIEWS !== "1") notFound();
  return (
    <main id="main" className="mx-auto max-w-[var(--w)] px-4 py-8">
      <h1 className="text-2xl font-bold">Module previews</h1>
      <p className="mt-2 text-fg2">
        Module agents add these preview pages as their work lands. Enable a module’s feature flag to
        view its content.
      </p>
      <ul className="mt-4 grid gap-2">
        <li>
          <Link href="/dev/foundation">Foundation boundary checks</Link>
        </li>
        {Object.entries(moduleFlags())
          .filter(([name]) => name !== "sell")
          .map(([name, enabled]) => (
            <li key={name}>
              <Link href={`/dev/${name}`}>{name}</Link> — {enabled ? "enabled" : "flag off"}
            </li>
          ))}
      </ul>
    </main>
  );
}
