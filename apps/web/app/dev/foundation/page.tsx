import { notFound } from "next/navigation";
import { ModuleBoundary } from "@/components/module-boundary";
import { ThrowingModule } from "./throwing";

export const dynamic = "force-dynamic";
export default async function FoundationPreview({
  searchParams,
}: {
  searchParams: Promise<{ server?: string; health?: string; stale?: string }>;
}) {
  if (process.env.NODE_ENV === "production" && process.env.TALLY_DEV_PREVIEWS !== "1") notFound();
  const params = await searchParams;
  return (
    <main id="main" className="mx-auto grid max-w-[var(--w)] gap-4 px-4 py-8">
      <h1 className="text-2xl font-bold">Foundation preview</h1>
      {params.health === "1" ? (
        <ModuleBoundary module="guardian">
          <section>Unhealthy module content</section>
        </ModuleBoundary>
      ) : params.stale === "1" ? (
        <ModuleBoundary module="autopilot">
          <section>Stale module content</section>
        </ModuleBoundary>
      ) : params.server === "1" ? (
        <ModuleBoundary
          module="flow"
          load={() => {
            throw new Error("Intentional server load failure");
          }}
        />
      ) : (
        <ModuleBoundary module="flow">
          <ThrowingModule />
        </ModuleBoundary>
      )}
      <ModuleBoundary module="statement">
        <section className="glass p-4">Statement remains available</section>
      </ModuleBoundary>
      <ModuleBoundary module="quality">
        <section>Quality flag is enabled</section>
      </ModuleBoundary>
    </main>
  );
}
