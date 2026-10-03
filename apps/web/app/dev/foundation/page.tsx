import { notFound } from "next/navigation";
import { ModuleBoundary } from "@/components/module-boundary";
import { ThrowingModule } from "./throwing";
import { HealthContent } from "./health-content";

export const dynamic = "force-dynamic";
export default async function FoundationPreview({
  searchParams,
}: {
  searchParams: Promise<{
    server?: string;
    health?: string;
    stale?: string;
    never?: string;
    cadence?: string;
  }>;
}) {
  if (process.env.NODE_ENV === "production" && process.env.TALLY_DEV_PREVIEWS !== "1") notFound();
  const params = await searchParams;
  return (
    <main id="main" className="mx-auto grid max-w-[var(--w)] gap-4 px-4 py-8">
      <h1 className="text-2xl font-bold">Foundation preview</h1>
      {params.never === "1" ? (
        <ModuleBoundary module="rewards">
          <section>Never-succeeded module content</section>
        </ModuleBoundary>
      ) : params.cadence === "1" ? (
        <ModuleBoundary
          module="statement"
          load={(state) => (
            <section>Five-minute statement: degraded={String(state.degraded)}</section>
          )}
        />
      ) : params.health === "1" ? (
        <ModuleBoundary
          module="guardian"
          load={(state) => (
            <section>
              Unhealthy module content — degraded={String(state.degraded)}, ageMs={state.ageMs};{" "}
              {state.reason}
            </section>
          )}
        />
      ) : params.stale === "1" ? (
        <ModuleBoundary module="autopilot">
          <HealthContent />
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
