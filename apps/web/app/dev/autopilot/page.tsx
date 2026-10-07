import { notFound } from "next/navigation";
import { moduleFlags } from "@/lib/flags";
import { AutopilotPlain } from "@/modules/autopilot/plain";
import { previewAutopilot } from "@/modules/autopilot/preview-fixture";

export const dynamic = "force-dynamic";
export default async function AutopilotPreview() {
  if (
    (process.env.NODE_ENV === "production" && process.env.TALLY_DEV_PREVIEWS !== "1") ||
    !moduleFlags().autopilot
  )
    notFound();
  return (
    <main id="main">
      <h1>Autopilot preview — constructed data</h1>
      <AutopilotPlain vm={await previewAutopilot()} />
    </main>
  );
}
