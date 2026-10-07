import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuardianScreen } from "@/components/guardian/guardian-screen";
import { ModuleBoundary } from "@/components/module-boundary";
import { VmDegraded } from "@/components/portfolio/vm-shared";
import { moduleFlags } from "@/lib/flags";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Guardian: alerts for your tokens · Tally" };

/** Alerts and Telegram link for the signed-in wallet. 404 with the `guardian` flag off. The data is private: see GuardianScreen. */
export default function Page() {
  if (!moduleFlags().guardian) notFound();
  return (
    <main id="main" className="wrap pb-24 pt-10 min-[561px]:pt-14">
      <p className="t-kicker">Guardian</p>
      <h1 className="t-h2 mt-3 max-w-[22ch]">Hear about problems before you trade.</h1>
      <p className="t-lead mt-3 max-w-[62ch]">
        Guardian watches the tokens in your wallet and records an alert when something changes. It
        states what changed and shows the reading it came from. It never trades for you.
      </p>
      <div className="mt-8">
        <ModuleBoundary
          module="guardian"
          fallback={<VmDegraded name="Guardian" reason={null} ageMs={null} />}
          load={() => <GuardianScreen />}
        />
      </div>
    </main>
  );
}
