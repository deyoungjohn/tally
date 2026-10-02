"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { bsc } from "viem/chains";
import type { ReactNode } from "react";

/**
 * Privy is loaded only on routes that need a wallet (M3: trade flow, portfolio). The landing page
 * stays free of the wallet SDK to protect the JS budget (blueprint §11).
 * BSC (chain 56) is the only chain: hard requirement (blueprint §4, §8.1).
 */
export function WalletProviders({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    return (
      <p role="alert" className="wrap section-pad text-red">
        NEXT_PUBLIC_PRIVY_APP_ID is not set.
      </p>
    );
  }
  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: bsc,
        supportedChains: [bsc],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        appearance: { theme: "dark", accentColor: "#e8ebef" },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
