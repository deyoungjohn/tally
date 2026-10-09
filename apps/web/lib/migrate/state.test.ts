/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  readPendingMigrate,
  writePendingMigrate,
  clearPendingMigrate,
  roundDownToCent,
  proceedsMeetBuyMinimum,
  type PendingMigrate,
} from "./state";

describe("Migrate state", () => {
  beforeEach(() => {
    let store: Record<string, string> = {};
    (globalThis as any).window = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        store = {};
      },
    };
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads and writes pending migrate state", () => {
    const pm: PendingMigrate = {
      id: "mig-123",
      wallet: "0x1234567890abcdef1234567890abcdef12345678",
      ticker: "NVDA",
      from: "bstock",
      to: "ondo",
      step: 1,
      createdAt: Date.now(),
    };
    writePendingMigrate(pm);
    const read = readPendingMigrate("0x1234567890abcdef1234567890abcdef12345678");
    expect(read).toEqual(pm);
  });

  it("safely discards old shape without wallet and removes it from storage", () => {
    // Old shape with no wallet field
    const oldShape = {
      id: "mig-old",
      ticker: "NVDA",
      from: "bstock",
      to: "ondo",
      step: 1,
      createdAt: Date.now(),
    };
    localStorage.setItem("tally.pendingMigrate", JSON.stringify(oldShape));

    const read = readPendingMigrate("0x1234567890abcdef1234567890abcdef12345678");
    expect(read).toBeNull();
    // Verify it was removed from localStorage
    expect(localStorage.getItem("tally.pendingMigrate")).toBeNull();
  });

  it("ignores and removes saved migration for a different wallet", () => {
    const pm: PendingMigrate = {
      id: "mig-123",
      wallet: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ticker: "NVDA",
      from: "bstock",
      to: "ondo",
      step: 1,
      createdAt: Date.now(),
    };
    writePendingMigrate(pm);

    // Connected with different wallet
    const read = readPendingMigrate("0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
    expect(read).toBeNull();
    // State for different wallet must be removed
    expect(localStorage.getItem("tally.pendingMigrate")).toBeNull();
  });

  it("matches wallet case-insensitively", () => {
    const pm: PendingMigrate = {
      id: "mig-123",
      wallet: "0x1234567890ABCDEF1234567890ABCDEF12345678",
      ticker: "NVDA",
      from: "bstock",
      to: "ondo",
      step: 1,
      createdAt: Date.now(),
    };
    writePendingMigrate(pm);
    const read = readPendingMigrate("0x1234567890abcdef1234567890abcdef12345678");
    expect(read).toEqual(pm);
  });

  it("returns null when currentWallet is explicitly null (signed out)", () => {
    const pm: PendingMigrate = {
      id: "mig-123",
      wallet: "0x1234567890abcdef1234567890abcdef12345678",
      ticker: "NVDA",
      from: "bstock",
      to: "ondo",
      step: 1,
      createdAt: Date.now(),
    };
    writePendingMigrate(pm);
    expect(readPendingMigrate(null)).toBeNull();
  });

  it("expires pending migrate state after 24 hours", () => {
    const pm: PendingMigrate = {
      id: "mig-123",
      wallet: "0x1234567890abcdef1234567890abcdef12345678",
      ticker: "NVDA",
      from: "bstock",
      to: "ondo",
      step: 1,
      createdAt: Date.now() - 25 * 60 * 60 * 1000,
    };
    writePendingMigrate(pm);
    const read = readPendingMigrate("0x1234567890abcdef1234567890abcdef12345678");
    expect(read).toBeNull();
  });

  it("clears pending migrate state", () => {
    const pm: PendingMigrate = {
      id: "mig-123",
      wallet: "0x1234567890abcdef1234567890abcdef12345678",
      ticker: "NVDA",
      from: "bstock",
      to: "ondo",
      step: 1,
      createdAt: Date.now(),
    };
    writePendingMigrate(pm);
    clearPendingMigrate();
    expect(readPendingMigrate("0x1234567890abcdef1234567890abcdef12345678")).toBeNull();
  });

  it("rounds down to cent", () => {
    // 6.9967 USDT = 6996700000000000000n -> 6.99 USDT = 6990000000000000000n
    expect(roundDownToCent("6996700000000000000")).toBe("6990000000000000000");
    expect(roundDownToCent(6996700000000000000n)).toBe("6990000000000000000");
    // exactly 6.00
    expect(roundDownToCent("6000000000000000000")).toBe("6000000000000000000");
  });

  it("checks buy minimum", () => {
    expect(proceedsMeetBuyMinimum("6000000000000000000")).toBe(true);
    expect(proceedsMeetBuyMinimum("5999999999999999999")).toBe(false);
    expect(proceedsMeetBuyMinimum("7000000000000000000")).toBe(true);
  });
});
