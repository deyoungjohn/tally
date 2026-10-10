import { notFound } from "next/navigation";
import { moduleFlags } from "@/lib/flags";
import { PiesPlain } from "@/modules/pies/plain";
import { previewPies } from "@/modules/pies/preview-fixture";

export const dynamic = "force-dynamic";
export default function PiesPreview() {
  if (
    (process.env.NODE_ENV === "production" && process.env.TALLY_DEV_PREVIEWS !== "1") ||
    !moduleFlags().pies
  )
    notFound();
  return (
    <main id="main">
      <h1>Baskets preview</h1>
      <PiesPlain vm={previewPies()} />
    </main>
  );
}
