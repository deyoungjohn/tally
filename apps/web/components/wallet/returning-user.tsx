"use client";

import { useTallyWallet } from "./wallet-context";
import { cn } from "@/lib/utils";

/** Under the Get Started button: people who already have an account skip straight to sign-in or a wallet connection. */
export function ReturningUser({ className }: { className?: string }) {
  const wallet = useTallyWallet();
  if (wallet.authenticated) return null;
  return (
    <p className={cn("t-meta", className)} data-testid="returning-user">
      Returning user?{" "}
      <button
        type="button"
        className="learn-more"
        onClick={() => wallet.login()}
        disabled={!wallet.ready}
      >
        Sign in
      </button>{" "}
      or{" "}
      <button
        type="button"
        className="learn-more"
        onClick={() => wallet.connectExternal()}
        disabled={!wallet.ready}
      >
        Connect your wallet
      </button>
    </p>
  );
}
