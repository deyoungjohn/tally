import { notFound } from "next/navigation";
import { GuardianPlain } from "@/modules/guardian/plain";

export const dynamic = "force-dynamic";

export default async function GuardianDevPreview({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  if (process.env.NODE_ENV === "production" && process.env.TALLY_DEV_PREVIEWS !== "1") {
    notFound();
  }

  const params = await searchParams;
  const testWallet =
    process.env.NODE_ENV !== "production" ? process.env.TALLY_TEST_WALLET : undefined;
  const address = params.address ?? testWallet ?? "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930";

  return (
    <main className="mx-auto max-w-[var(--w)] px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">Guardian Module Dev Preview</h1>
      <p className="mb-6 text-sm text-[var(--fg2)]">
        Wallet address: <code>{address}</code>
      </p>
      <div className="glass p-6">
        <GuardianPlain walletAddress={address} />
      </div>
    </main>
  );
}
