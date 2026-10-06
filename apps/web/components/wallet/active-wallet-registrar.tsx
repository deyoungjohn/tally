"use client";
// After sign-in, while the statement module is on, tell the server which wallet to keep a portfolio snapshot for. The server
// verifies the Privy access token and checks the named wallet belongs to that user (it never trusts the address alone), so the
// browser only presents proof: `Authorization: Bearer <access token>` and `x-tally-wallet`. Renders nothing, wraps nothing.
// Privy's per-render functions stay behind the wallet context's refs (wallet bridge rule): only primitives are dependencies here.

import { useEffect, useRef } from "react";
import { useModuleFlags } from "@/lib/hooks/use-flags";
import { useTallyWallet } from "./wallet-context";

export function ActiveWalletRegistrar() {
  const wallet = useTallyWallet();
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const on = useModuleFlags().statement === true;
  const address = wallet.authenticated ? wallet.address : undefined;

  useEffect(() => {
    if (!on || !address) return;
    const key = `tally.activeWallet.${address.toLowerCase()}`;
    try {
      if (sessionStorage.getItem(key)) return; // already registered in this tab
    } catch {
      /* storage blocked: register again on the next load, which the server de-duplicates */
    }
    let cancelled = false;
    void (async () => {
      const token = await walletRef.current.getAccessToken();
      if (!token || cancelled) return;
      const res = await fetch("/api/session/active-wallet", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "x-tally-wallet": address },
        cache: "no-store",
      }).catch(() => null);
      // 204 = registered (or already was). Anything else (the route not deployed yet, 401, 404) is silent: the Portfolio
      // simply keeps its honest "not collected yet" state.
      if (res?.ok && !cancelled) {
        try {
          sessionStorage.setItem(key, "1");
        } catch {
          /* fine */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [on, address]);

  return null;
}
