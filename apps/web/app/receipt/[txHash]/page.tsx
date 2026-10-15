import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModuleBoundary } from "@/components/module-boundary";
import { ReceiptView } from "@/components/receipts/receipt-view";
import { VmDegraded } from "@/components/portfolio/vm-shared";
import { moduleFlags } from "@/lib/flags";
import { loadReceipt } from "@/modules/receipts/view-model";
import { getEngine } from "@/lib/server/engine";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Transaction Receipt | Tally" };

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
        load={async () => {
          const vm = await loadReceipt(txHash);
          // Tally's own check can lag behind the chain: ask the chain (RPC first, the explorer when the RPC is slow) so a
          // confirmed transaction is never shown as pending.
          let chain: { block: string; ok: boolean } | null = null;
          if (vm.state === "pending" && /^0x[0-9a-fA-F]{64}$/.test(txHash)) {
            try {
              const r = await (await getEngine()).transactions.getReceipt(txHash);
              if (r) chain = { block: r.blockNumber.toString(), ok: r.status === "success" };
            } catch {
              /* the page keeps saying it is waiting */
            }
          }
          // The contract address stays out of the page (and out of its data payload); the screen does not show it.
          return (
            <ReceiptView
              vm={{ ...vm, evidence: { ...vm.evidence, guard: null } }}
              fixtures={fixtures}
              qualityOn={flags.quality}
              chain={chain}
            />
          );
        }}
      />
    </main>
  );
}
