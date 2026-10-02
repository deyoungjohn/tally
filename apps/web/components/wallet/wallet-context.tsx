"use client";

import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import { USDT_BSC } from "@tally/config";

/** What the trade UI needs from a wallet, whatever provides it (Privy embedded, an external wallet, or the e2e mock). */
export interface SendTx {
  to: `0x${string}`;
  data: Hex;
  /** Exact gas limit to send (estimate × 1.25, simulated at this limit). Never the API's 450000. */
  gas?: bigint;
}

export interface TallyWallet {
  /** The provider has finished loading. */
  ready: boolean;
  /** Keyed off Privy's `authenticated`, never off the connected-wallet list, which survives sign-out (M0 finding). */
  authenticated: boolean;
  address?: `0x${string}`;
  /** Embedded (email or social login) wallet, as opposed to an external one. */
  embedded: boolean;
  /** Opens the sign-in dialog (email, social, or an existing wallet). */
  login(): void;
  logout(): void;
  /** Link or switch to an external wallet (top-up tier 2). */
  connectExternal(): void;
  /** Reads the wallet's real chain, switches to BSC (56) if needed, signs and sends. Resolves with the tx hash. */
  sendTx(tx: SendTx): Promise<Hex>;
}

const IDLE: TallyWallet = {
  ready: false,
  authenticated: false,
  embedded: false,
  login() {},
  logout() {},
  connectExternal() {},
  async sendTx() {
    throw new Error("Wallet is not ready");
  },
};

const Ctx = createContext<TallyWallet>(IDLE);
export const useTallyWallet = () => useContext(Ctx);
export const WalletCtxProvider = Ctx.Provider;

/**
 * Test hook for Playwright and offline demos. A page that defines `window.__tallyMockWallet` before it loads gets a fake
 * wallet that never signs anything real: it returns pseudo transaction hashes, which only the fixture-mode server understands.
 * On the real server those hashes simply never confirm, so the hook cannot move money.
 */
interface MockSpec {
  address: `0x${string}`;
  signedIn?: boolean;
  /** Simulate the user rejecting the signature. */
  reject?: boolean;
}
declare global {
  interface Window {
    __tallyMockWallet?: MockSpec;
  }
}
const MOCK_APPROVE = `0x${"a1".padStart(64, "0")}` as Hex;
const MOCK_SWAP = `0x${"b2".padStart(64, "0")}` as Hex;

function MockWallet({ spec, children }: { spec: MockSpec; children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(Boolean(spec.signedIn));
  const value = useMemo<TallyWallet>(
    () => ({
      ready: true,
      authenticated: signedIn,
      address: signedIn ? spec.address : undefined,
      embedded: true,
      login: () => setSignedIn(true),
      logout: () => setSignedIn(false),
      connectExternal: () => setSignedIn(true),
      async sendTx(tx) {
        await new Promise((r) => setTimeout(r, 250));
        if (spec.reject)
          throw Object.assign(new Error("User rejected the request"), { code: 4001 });
        return tx.to.toLowerCase() === USDT_BSC.toLowerCase() ? MOCK_APPROVE : MOCK_SWAP;
      },
    }),
    [signedIn, spec],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Real wallets load lazily: the Privy SDK stays out of every route that does not trade (JS budget, blueprint §11). */
export function WalletRoot({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<"pending" | "mock" | "privy">("pending");
  const [Privy, setPrivy] = useState<null | typeof import("./privy-wallet").PrivyWallet>(null);
  useEffect(() => {
    if (window.__tallyMockWallet) {
      setMode("mock");
      return;
    }
    setMode("privy");
    void import("./privy-wallet").then((m) => setPrivy(() => m.PrivyWallet));
  }, []);
  if (mode === "mock") return <MockWallet spec={window.__tallyMockWallet!}>{children}</MockWallet>;
  if (mode === "privy" && Privy) return <Privy>{children}</Privy>;
  return <Ctx.Provider value={IDLE}>{children}</Ctx.Provider>;
}
