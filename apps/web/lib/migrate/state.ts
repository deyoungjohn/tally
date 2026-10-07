export interface PendingMigrate {
  id: string;
  ticker: string;
  from: "ondo" | "bstock";
  to: "ondo" | "bstock";
  step: 1 | 2;
  saleHash?: string;
  usdtBefore?: string;
  usdtReceived?: string;
  buyHash?: string;
  createdAt: number;
}

export const MIGRATE_STORAGE_KEY = "tally.pendingMigrate";
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function readPendingMigrate(): PendingMigrate | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(MIGRATE_STORAGE_KEY);
    if (!raw) return null;
    const pm = JSON.parse(raw) as PendingMigrate;
    if (Date.now() - pm.createdAt > TWENTY_FOUR_HOURS_MS) {
      localStorage.removeItem(MIGRATE_STORAGE_KEY);
      return null;
    }
    return pm;
  } catch {
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
