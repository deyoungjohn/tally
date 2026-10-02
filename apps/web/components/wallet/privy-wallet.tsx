"use client";

import { PrivyProvider, usePrivy, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { useEffect, useMemo, useRef } from "react";
import { createWalletClient, custom, toHex, type Hex } from "viem";
import { bsc } from "viem/chains";
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
        appearance: { theme: "dark", accentColor: "#e8ebef", showWalletLoginFirst: false },
      }}
    >
      <Bridge onChange={onChange} />
    </PrivyProvider>
  );
}

const isUserRejection = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { code?: number }).code === 4001;

function Bridge({ onChange }: { onChange: (w: TallyWallet) => void }) {
  const { ready, authenticated, login, logout, connectWallet } = usePrivy();
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();

  // A wallet the user connected on purpose (top-up tier 2) wins over the embedded one. Only meaningful while `authenticated`.
  const wallet = authenticated
    ? (wallets.find((w) => w.walletClientType !== "privy") ??
      wallets.find((w) => w.walletClientType === "privy"))
    : undefined;

  // Privy hands back NEW function objects on every render. If they were dependencies of the value pushed to the app, every
  // render would publish a new value, re-render the app, re-render this bridge and loop forever (React error #185). So the
  // functions live in refs and the published value depends only on primitives.
  const live = useRef({ login, logout, connectWallet, sendTransaction, wallet });
  live.current = { login, logout, connectWallet, sendTransaction, wallet };
  const address = wallet?.address as `0x${string}` | undefined;
  const embedded = wallet?.walletClientType === "privy";

  const value = useMemo<TallyWallet>(
    () => ({
      ready,
      authenticated,
      address,
      embedded,
      login: () => live.current.login(),
      logout: () => void live.current.logout(),
      connectExternal: () => live.current.connectWallet(),
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
                value: 0,
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
          const wc = createWalletClient({ account: from, chain: bsc, transport: custom(provider) });
          return await wc.sendTransaction({ to: tx.to, data: tx.data, value: 0n, gas: tx.gas });
        } catch (e) {
          if (isUserRejection(e))
            throw Object.assign(new Error("Signature rejected"), { code: 4001 });
          throw e;
        }
      },
    }),
    [ready, authenticated, address, embedded],
  );
  useEffect(() => onChange(value), [value, onChange]);
  return null;
}
