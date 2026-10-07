"use client";
// The one place the app attaches proof of sign-in to a request. The server verifies the Privy access token and checks the named
// wallet belongs to that user (it never trusts an address alone), so the browser only presents `Authorization: Bearer <token>`
// and `x-tally-wallet`. The token is read per call, never stored or logged. Privy's per-render functions stay behind the wallet
// context's refs (wallet bridge rule): `sessionFetch` is stable and only primitives drive effects.

import { useCallback, useRef } from "react";
import { useTallyWallet, type TallyWallet } from "@/components/wallet/wallet-context";

/** Fetch with the session headers. Resolves null when there is no sign-in to present (signed out, or no token could be read). */
export async function fetchWithSession(
  wallet: Pick<TallyWallet, "authenticated" | "address" | "getAccessToken">,
  url: string,
  init: RequestInit = {},
): Promise<Response | null> {
  if (!wallet.authenticated || !wallet.address) return null;
  const token = await wallet.getAccessToken();
  if (!token) return null;
  return fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "x-tally-wallet": wallet.address,
    },
  });
}

export function useSessionFetch() {
  const wallet = useTallyWallet();
  const ref = useRef(wallet);
  ref.current = wallet;
  const sessionFetch = useCallback(
    (url: string, init?: RequestInit) => fetchWithSession(ref.current, url, init),
    [],
  );
  return {
    sessionFetch,
    signedIn: wallet.authenticated && !!wallet.address,
    address: wallet.address,
    /** The provider has finished loading, so "signed out" is an answer and not a wait. */
    ready: wallet.ready,
    login: wallet.login,
  };
}
