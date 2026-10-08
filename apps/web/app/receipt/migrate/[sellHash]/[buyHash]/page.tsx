import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModuleBoundary } from "@/components/module-boundary";
import { VmDegraded } from "@/components/portfolio/vm-shared";
import { moduleFlags } from "@/lib/flags";
import { loadMigrateReceipt } from "@/lib/server/migrate-receipt";
import { MigrateReceiptView } from "@/components/trade/migrate-receipt-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Migrate receipt · Tally" };

export default async function Page({
  params,
}: {
  params: Promise<{ sellHash: string; buyHash: string }>;
}) {
  const flags = moduleFlags();
  if (!flags.receipts || !flags.switch) notFound();

  const { sellHash, buyHash } = await params;

  return (
    <main id="main" className="wrap pb-24 pt-10 min-[561px]:pt-14">
      <ModuleBoundary
        module="receipts"
        fallback={<VmDegraded name="Receipts" reason={null} ageMs={null} />}
        load={async () => {
          const result = await loadMigrateReceipt(sellHash, buyHash);

          if (result.state === "not_a_migrate") {
            return (
              <div className="max-w-[520px] mx-auto bg-transparent rounded-xl shadow-sm border border-white/15 p-8 text-center">
                <h1 className="text-lg font-semibold mb-4">
                  These two transactions are not a Migrate
                </h1>
                <p className="text-white/60 mb-6">
                  They might be from different wallets, out of order, or involve different assets.
                </p>
                <div className="flex flex-col gap-3">
                  <a href={`/receipt/${sellHash}`} className="text-orange-500 hover:underline">
                    View Sale Receipt
                  </a>
                  <a href={`/receipt/${buyHash}`} className="text-orange-500 hover:underline">
                    View Buy Receipt
                  </a>
                </div>
              </div>
            );
          }

          return (
            <div className="max-w-[700px] mx-auto p-6 bg-black rounded-2xl border border-white/15 shadow-sm">
              <h1 className="text-xl font-bold mb-4">Migrate Receipt</h1>
              <MigrateReceiptView vm={result.vm} />
            </div>
          );
        }}
      />
    </main>
  );
}
