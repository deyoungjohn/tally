import { notFound } from "next/navigation";
import { WalletProviders } from "@/components/providers";
import { WalletCheck } from "./wallet-check";

export const metadata = { title: "Wallet check (M0)", robots: { index: false } };

/** M0 exit check ③ (blueprint §8.1): create a Privy embedded wallet on BSC and send a real 0-value self-transfer. Removed in M3. */
export default function Page() {
  if (process.env.NEXT_PUBLIC_ENABLE_WALLET_CHECK !== "1") notFound();
  return (
    <WalletProviders>
      <WalletCheck />
    </WalletProviders>
  );
}
