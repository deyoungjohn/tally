import { notFound } from "next/navigation";
import { QualityPlain } from "../../../modules/quality/plain";
export const dynamic = "force-dynamic";
export default function QualityPreview() {
  if (
    (process.env.NODE_ENV === "production" && process.env.TALLY_DEV_PREVIEWS !== "1") ||
    process.env.FEATURE_QUALITY !== "1"
  )
    notFound();
  return (
    <main id="main">
      <h1>Quality preview</h1>
      <QualityPlain />
    </main>
  );
}
