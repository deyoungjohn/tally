import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModuleBoundary } from "@/components/module-boundary";
import { ReceiptView } from "@/components/receipts/receipt-view";
import { VmDegraded } from "@/components/portfolio/vm-shared";
import { moduleFlags } from "@/lib/flags";
import { loadReceipt } from "@/modules/receipts/view-model";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Transaction receipt · Tally" };

/** The shareable receipt for one transaction. Public chain data: no wallet or sign-in needed. 404 with the receipts flag off. */
export default async function Page({ params }: { params: Promise<{ txHash: string }> }) {
  const flags = moduleFlags();
  if (!flags.receipts) notFound();
  const { txHash } = await params;
  const fixtures = process.env.TALLY_FIXTURES === "1";
  return (
    <main id="main" className="wrap pb-24 pt-10 min-[561px]:pt-14">
      <ModuleBoundary
        module="receipts"
        fallback={<VmDegraded name="Receipts" reason={null} ageMs={null} />}
        load={async () => (
          <ReceiptView
            vm={await loadReceipt(txHash)}
            fixtures={fixtures}
            qualityOn={flags.quality}
          />
        )}
      />
    </main>
  );
}
