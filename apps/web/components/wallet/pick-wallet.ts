/**
 * Pure wallet choice function (WO-01 wallet identity fix).
 *
 * Rules:
 * - When not authenticated: returns undefined.
 * - An external wallet is used ONLY if the user deliberately connected it in the current session
 *   (explicitAddress matches its address).
 * - Otherwise the embedded wallet (walletClientType === "privy") is used.
 * - Never fall back to a leftover external wallet.
 */
export interface WalletLike {
  address: string;
  walletClientType: string;
}

export interface PickWalletParams<W extends WalletLike> {
  authenticated: boolean;
  wallets: W[];
  explicitAddress?: string | null;
}

export function pickWallet<W extends WalletLike>({
  authenticated,
  wallets,
  explicitAddress,
}: PickWalletParams<W>): W | undefined {
  if (!authenticated) return undefined;

  if (explicitAddress) {
    const explicitLower = explicitAddress.toLowerCase();
    const external = wallets.find(
      (w) => w.walletClientType !== "privy" && w.address.toLowerCase() === explicitLower,
    );
    if (external) return external;
  }

  return wallets.find((w) => w.walletClientType === "privy");
}
