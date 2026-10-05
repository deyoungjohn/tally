import { notFound } from "next/navigation";
import { ReceiptsPlain } from "../../../modules/receipts/plain";
export const dynamic = "force-dynamic";
export default async function ReceiptsPreview({
  searchParams,
}: {
  searchParams: Promise<{ txHash?: string }>;
}) {
  if (
    (process.env.NODE_ENV === "production" && process.env.TALLY_DEV_PREVIEWS !== "1") ||
    process.env.FEATURE_RECEIPTS !== "1"
  )
    notFound();
  const { txHash } = await searchParams;
  return (
    <main id="main">
      <h1>Receipts preview</h1>
      <ReceiptsPlain txHash={txHash} />
    </main>
  );
}
