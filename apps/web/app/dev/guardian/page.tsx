import { notFound } from "next/navigation";
import { GuardianPlain } from "../../../modules/guardian/plain";

export const dynamic = "force-dynamic";

export default async function GuardianDevPreview(_props?: {
  searchParams?: Promise<{ address?: string }>;
}) {
  if (process.env.NODE_ENV === "production" && process.env.TALLY_DEV_PREVIEWS !== "1") {
    notFound();
  }

  // Security finding 1: Never accept address from query string.
  // In development, use TALLY_TEST_WALLET. In production mode (even with previews enabled),
  // walletAddress is undefined so the empty fixture state is rendered and no active code is shown.
  const isDev = process.env.NODE_ENV !== "production";
  const address = isDev ? process.env.TALLY_TEST_WALLET : undefined;

  return (
    <main className="mx-auto max-w-[var(--w)] px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">Guardian Module Dev Preview</h1>
      <p className="mb-6 text-sm text-[var(--fg2)]">
        Wallet address: <code>{address ?? "None (production preview mode)"}</code>
      </p>
      <div className="glass p-6">
        <GuardianPlain walletAddress={address} issueNewLinkCode={false} />
      </div>
    </main>
  );
}
