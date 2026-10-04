import { notFound } from "next/navigation";
import { RadarPlain } from "@/modules/flow/plain";
import { moduleFlags } from "@/lib/flags";
export const dynamic = "force-dynamic";
export default function FlowPreview() {
  if (
    (process.env.NODE_ENV === "production" && process.env.TALLY_DEV_PREVIEWS !== "1") ||
    !moduleFlags().flow
  )
    notFound();
  return (
    <main id="main">
      <h1>Flow preview</h1>
      <RadarPlain />
    </main>
  );
}
