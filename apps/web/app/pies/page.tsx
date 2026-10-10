// "Pies" was the module's first name and still names the code (module, flag, route, files). The product calls them Baskets.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Info } from "lucide-react";
import { PiesScreen } from "@/components/pies/pies-screen";
import { VmDegraded } from "@/components/portfolio/vm-shared";
import { moduleFlags } from "@/lib/flags";
import { loadPiesPage } from "@/modules/pies/view-model";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Baskets | Tally",
  description:
    "Buy a basket of tokenized stocks in one go: pick a basket, set a budget and the weights.",
};

/**
 * Buy a basket of tokenized stocks, one after another through the guarantee. 404 with the `pies` flag off.
 * Baskets read no worker snapshot (templates and live quotes only), so the page is not gated on module health: gating it made
 * it show "catching up" forever, because no worker job ever reports health for it.
 */
export default async function Page() {
  if (!moduleFlags().pies) notFound();
  let content: React.ReactNode;
  try {
    content = <PiesScreen initial={await loadPiesPage()} />;
  } catch {
    console.warn("baskets page failed to load; showing its degraded card");
    content = <VmDegraded name="Baskets" reason={null} ageMs={null} />;
  }
  return (
    <main id="main" className="wrap pb-24 pt-10 min-[561px]:pt-14">
      <p className="t-kicker">Baskets</p>
      <h1 className="t-h2 mt-3 max-w-[22ch]">Buy a basket of stocks in one go.</h1>
      <p className="t-lead mt-3 max-w-[62ch]">
        Pick a basket, set a budget and how much goes to each stock, and Tally buys them one after
        another. Each purchase has its own guaranteed minimum, and you confirm each one in your
        wallet.
      </p>
      <p className="t-meta mt-3 flex items-center gap-2" data-testid="baskets-signin-note">
        <Info size={14} aria-hidden /> For the best experience with baskets, sign in with Google or
        email.
      </p>
      <div className="mt-8">{content}</div>
    </main>
  );
}
