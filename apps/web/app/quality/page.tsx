import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModuleBoundary } from "@/components/module-boundary";
import { QualityView } from "@/components/receipts/quality-view";
import { VmDegraded } from "@/components/portfolio/vm-shared";
import { moduleFlags } from "@/lib/flags";
import { loadQuality } from "@/modules/quality/view-model";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Execution quality · Tally" };

/** How fills compare with quotes. 404 with the `quality` flag off. */
export default function Page() {
  if (!moduleFlags().quality) notFound();
  const fixtures = process.env.TALLY_FIXTURES === "1";
  return (
    <main id="main" className="wrap pb-24 pt-10 min-[561px]:pt-14">
      <p className="t-kicker">Quality</p>
      <h1 className="t-h2 mt-3 max-w-[22ch]">How the fills compare with the quotes.</h1>
      <p className="t-lead mt-3 max-w-[62ch]">
        Every completed purchase is checked against what was quoted and simulated. These are the
        results, by issuer and by route length, from chain-verified fills only.
      </p>
      <div className="mt-8">
        <ModuleBoundary
          module="quality"
          fallback={<VmDegraded name="Quality" reason={null} ageMs={null} />}
          load={async () => <QualityView vm={await loadQuality()} fixtures={fixtures} />}
        />
      </div>
    </main>
  );
}
