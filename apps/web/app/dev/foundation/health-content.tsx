"use client";

import { useModuleHealth } from "@/components/module-boundary-client";

export function HealthContent() {
  const state = useModuleHealth();
  return (
    <section>
      Stale module content — degraded={String(state?.degraded)}, stale={String(state?.stale)};{" "}
      {state?.reason}
    </section>
  );
}
