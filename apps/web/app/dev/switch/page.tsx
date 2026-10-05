import { notFound } from "next/navigation";
import { SwitchPlain } from "../../../modules/switch/plain";

export const dynamic = "force-dynamic";

export default async function SwitchPreview() {
  if (
    (process.env.NODE_ENV === "production" && process.env.TALLY_DEV_PREVIEWS !== "1") ||
    process.env.FEATURE_SWITCH !== "1"
  ) {
    notFound();
  }

  return (
    <main id="main">
      <h1>Sell & Switch preview</h1>
      <SwitchPlain />
    </main>
  );
}
