"use client";

import {
  PrivyProvider,
  useConnectWallet,
  usePrivy,
  useSendTransaction,
  useWallets,
} from "@privy-io/react-auth";
import { useEffect, useMemo, useRef, useState } from "react";
import { createWalletClient, custom, toHex, type Hex } from "viem";
import { bsc } from "viem/chains";
import { resetJsonCache } from "@/lib/hooks/use-json";
import { pickWallet } from "./pick-wallet";
import { friendlyWalletError } from "./wallet-errors";
import type { TallyWallet } from "./wallet-context";

/**
 * Privy on BSC only (chain 56 is a hard requirement, blueprint §4 and §8.1). Embedded wallets are created at first login.
 * `showWalletUIs: false` because Tally shows its own confirm step (exact shares, minimum, fee); Privy's prompt would repeat it.
 */
export function PrivyWallet({ onChange }: { onChange: (w: TallyWallet) => void }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    // Browsing must keep working: only signing in is unavailable (the button stays disabled, `ready` is false).
    console.error("NEXT_PUBLIC_PRIVY_APP_ID is not set, so sign-in is unavailable.");
    return null;
  }
  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: bsc,
        supportedChains: [bsc],
        loginMethods: ["email", "google", "wallet"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          showWalletUIs: false,
        },
        appearance: { theme: "dark", accentColor: "#ffffff", showWalletLoginFirst: false },
      }}
    >
      <Bridge onChange={onChange} />
    </PrivyProvider>
  );
}

const isUserRejection = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { code?: number }).code === 4001;

function Bridge({ onChange }: { onChange: (w: TallyWallet) => void }) {
  const { user, ready, authenticated, login, logout, exportWallet, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const [explicitAddress, setExplicitAddress] = useState<string | null>(null);

  const { connectWallet } = useConnectWallet({
    onSuccess: (connected) => {
      setExplicitAddress(connected.wallet.address);
    },
  });

  const { sendTransaction } = useSendTransaction();

  // Reset explicit external wallet selection & cached JSON data whenever the Privy user ID changes
  const userId = user?.id;
  const lastUserId = useRef(userId);
  useEffect(() => {
    if (lastUserId.current !== undefined && lastUserId.current !== userId) {
      setExplicitAddress(null);
      resetJsonCache();
    }
    lastUserId.current = userId;
  }, [userId]);

  // Pure wallet selection: only uses external wallet if explicitly connected in this session
  const wallet = pickWallet({ authenticated, wallets, explicitAddress });

  // Privy hands back NEW function objects on every render. If they were dependencies of the value pushed to the app, every
  // render would publish a new value, re-render the app, re-render this bridge and loop forever (React error #185). So the
  // functions live in refs and the published value depends only on primitives.
  const handleLogout = async () => {
    setExplicitAddress(null);
    resetJsonCache();
    for (const w of wallets) {
      if (w.walletClientType !== "privy") {
        try {
          void w.disconnect();
        } catch {
          /* a failure must not block the logout */
        }
      }
    }
    try {
      await live.current.logout();
    } catch {
      /* fine */
    }
  };

  const live = useRef({
    login,
    logout,
    handleLogout,
    connectWallet,
    exportWallet,
    getAccessToken,
    sendTransaction,
    wallet,
  });
  live.current = {
    login,
    logout,
    handleLogout,
    connectWallet,
    exportWallet,
    getAccessToken,
    sendTransaction,
    wallet,
  };
  const address = wallet?.address as `0x${string}` | undefined;
  const embedded = wallet?.walletClientType === "privy";

  const value = useMemo<TallyWallet>(
    () => ({
      ready,
      authenticated,
      address,
      embedded,
      login: () => live.current.login(),
      logout: () => void live.current.handleLogout(),
      connectExternal: () => live.current.connectWallet(),
      exportWallet: () => {
        const w = live.current.wallet;
        if (w && w.walletClientType === "privy")
          void live.current.exportWallet({ address: w.address });
      },
      async getAccessToken() {
        try {
          return (await live.current.getAccessToken()) ?? null;
        } catch {
          return null;
        }
      },
      async sendTx(tx) {
        const w = live.current.wallet;
        if (!w) throw new Error("No wallet is connected");
        const from = w.address as `0x${string}`;
        try {
          if (w.walletClientType === "privy") {
            await w.switchChain(56);
            const r = await live.current.sendTransaction(
              {
                to: tx.to,
                data: tx.data,
                value: tx.value === undefined ? 0 : toHex(tx.value),
                chainId: 56,
                gasLimit: tx.gas === undefined ? undefined : toHex(tx.gas),
              },
              { address: from, uiOptions: { showWalletUIs: false } },
            );
            return r.hash as Hex;
          }
          // External wallet: read its REAL chain at send time and switch before signing (M0 finding: never trust a cached chain).
          const provider = await w.getEthereumProvider();
          const chainHex = (await provider.request({ method: "eth_chainId" })) as string;
          if (parseInt(chainHex, 16) !== 56) await w.switchChain(56);
          const wc = createWalletClient({
            account: from,
            chain: bsc,
            transport: custom(provider),
          });
          return await wc.sendTransaction({
            to: tx.to,
            data: tx.data,
            value: tx.value ?? 0n,
            gas: tx.gas,
          });
        } catch (e) {
          if (isUserRejection(e))
            throw Object.assign(new Error("Signature rejected"), { code: 4001 });
          throw friendlyWalletError(e);
        }
      },
    }),
    [ready, authenticated, address, embedded],
  );
  useEffect(() => onChange(value), [value, onChange]);
  return null;
}
