export interface PendingMigrate {
  id: string;
  wallet?: string;
  ticker: string;
  from: "ondo" | "bstock";
  to: "ondo" | "bstock";
  step: 1 | 2;
  saleHash?: string;
  usdtBefore?: string;
  usdtReceived?: string;
  buyHash?: string;
  createdAt: number;

  version?: number;
  tokensSpent?: string;
  sourceMultiplier?: string;
  destMultiplier?: string;
  sellPlan?: {
    route: string;
    vendor: string;
    quoteTime: number;
    simulation: boolean | null;
    guaranteedUsdt: string;
  };
  buyPlan?: {
    route: string;
    vendor: string;
    quoteTime: number;
    simulation: boolean | null;
    minShares: string;
  };
  pollStartedAt?: number;
  source?: "chain" | "receipt" | "wallet";
  isFixture?: boolean;
}

export const MIGRATE_STORAGE_KEY = "tally.pendingMigrate";
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function readPendingMigrate(currentWallet?: string | null): PendingMigrate | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(MIGRATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      localStorage.removeItem(MIGRATE_STORAGE_KEY);
      return null;
    }
    const pm = parsed as PendingMigrate;

    // Discard old shape safely (missing wallet or invalid createdAt)
    if (!pm.wallet || typeof pm.wallet !== "string" || !pm.createdAt) {
      localStorage.removeItem(MIGRATE_STORAGE_KEY);
      return null;
    }

    // Expire after 24 hours
    if (Date.now() - pm.createdAt > TWENTY_FOUR_HOURS_MS) {
      localStorage.removeItem(MIGRATE_STORAGE_KEY);
      return null;
    }

    // Ignore and remove a saved migration for a different wallet
    if (currentWallet && pm.wallet.toLowerCase() !== currentWallet.toLowerCase()) {
      localStorage.removeItem(MIGRATE_STORAGE_KEY);
      return null;
    }

    // If wallet was explicitly passed as null or empty, don't return an unauthenticated migration
    if (currentWallet === null || currentWallet === "") {
      return null;
    }

    return pm;
  } catch {
    try {
      localStorage.removeItem(MIGRATE_STORAGE_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

export function writePendingMigrate(pm: PendingMigrate) {
  if (typeof window === "undefined") return;
  localStorage.setItem(MIGRATE_STORAGE_KEY, JSON.stringify(pm));
}

export function clearPendingMigrate() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(MIGRATE_STORAGE_KEY);
}

/**
 * Round USDT proceeds down to the cent.
 * 1 USDT = 1e18 wei. 1 cent = 1e16 wei.
 */
export function roundDownToCent(usdtRaw: string | bigint): string {
  const value = BigInt(usdtRaw);
  const remainder = value % 10000000000000000n;
  return (value - remainder).toString();
}

/** Ensure expected USDT proceeds are at least 6 USDT */
export function proceedsMeetBuyMinimum(usdtRaw: string | bigint): boolean {
  return BigInt(usdtRaw) >= 6000000000000000000n; // 6 USDT
}
