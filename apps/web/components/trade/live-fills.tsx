"use client";
// The "Live fills" tab of the Trade page (formerly the Quality page): how completed purchases compare with what was quoted.
// It reads /api/vm/quality itself, so the tab needs no server-rendered data and the Trade page stays a client page.

import { QualityView } from "@/components/receipts/quality-view";
import { VmDegraded, VmSkeleton, type VmEnvelope } from "@/components/portfolio/vm-shared";
import type { QualityVM } from "@/modules/quality/view-model";
import { useJson } from "@/lib/hooks/use-json";

export function LiveFills({ active }: { active: boolean }) {
  // Nothing is fetched until the tab is opened.
  const env = useJson<VmEnvelope<QualityVM>>(active ? "/api/vm/quality" : null);
  const data = env.data;
  return (
    <section className="wrap pb-24 pt-8 min-[561px]:pt-12" aria-label="Live fills">
      <h1 className="t-h2 max-w-[22ch]">Live fills</h1>
      <p className="t-lead mt-3 max-w-[62ch]">
        Every completed purchase is checked against what was quoted and simulated. These are the
        results, by issuer and by route length.
      </p>
      <div className="mt-8">
        {data?.vm ? (
          <QualityView vm={data.vm} fixtures={data.fixtures === true} />
        ) : data?.degraded || env.error ? (
          <VmDegraded name="Live fills" reason={data?.reason ?? null} ageMs={data?.ageMs ?? null} />
        ) : (
          <VmSkeleton />
        )}
      </div>
    </section>
  );
}
