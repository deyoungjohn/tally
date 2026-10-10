import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModuleBoundary } from "@/components/module-boundary";
import { PiesScreen } from "@/components/pies/pies-screen";
import { VmDegraded } from "@/components/portfolio/vm-shared";
import { moduleFlags } from "@/lib/flags";
import { loadPiesPage } from "@/modules/pies/view-model";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pies: buy a basket of tokenized stocks · Tally" };

/** Buy a basket of tokenized stocks, one after another through the guarantee. 404 with the `pies` flag off. */
export default function Page() {
  if (!moduleFlags().pies) notFound();
  return (
    <main id="main" className="wrap pb-24 pt-10 min-[561px]:pt-14">
      <p className="t-kicker">Pies</p>
      <h1 className="t-h2 mt-3 max-w-[22ch]">Buy a basket of stocks in one go.</h1>
      <p className="t-lead mt-3 max-w-[62ch]">
        Pick a basket, set a budget and how much goes to each stock, and Tally buys them one after
        another. Each purchase has its own guaranteed minimum, and you confirm each one in your
        wallet.
      </p>
      <div className="mt-8">
        <ModuleBoundary
          module="pies"
          fallback={<VmDegraded name="Pies" reason={null} ageMs={null} />}
          load={async () => <PiesScreen initial={await loadPiesPage()} />}
        />
      </div>
    </main>
  );
}
