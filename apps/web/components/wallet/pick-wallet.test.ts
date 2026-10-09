import { describe, expect, it } from "vitest";
import { pickWallet, type WalletLike } from "./pick-wallet";

describe("pickWallet (WO-01 wallet identity)", () => {
  const embeddedWallet: WalletLike = {
    address: "0x1111111111111111111111111111111111111111",
    walletClientType: "privy",
  };

  const leftoverExternalWallet: WalletLike = {
    address: "0x2222222222222222222222222222222222222222",
    walletClientType: "okx_wallet",
  };

  const chosenExternalWallet: WalletLike = {
    address: "0x3333333333333333333333333333333333333333",
    walletClientType: "metamask",
  };

  it("1. not authenticated: returns undefined even if wallets exist in browser", () => {
    const picked = pickWallet({
      authenticated: false,
      wallets: [embeddedWallet, leftoverExternalWallet],
      explicitAddress: leftoverExternalWallet.address,
    });
    expect(picked).toBeUndefined();
  });

  it("2. embedded only: returns embedded wallet when no external wallet connected", () => {
    const picked = pickWallet({
      authenticated: true,
      wallets: [embeddedWallet],
      explicitAddress: null,
    });
    expect(picked).toBe(embeddedWallet);
  });

  it("3. external connected but not chosen: returns embedded wallet, ignoring leftover external wallet", () => {
    // Crucial bug reproduction: leftover browser extension connected, but user signed in with Google
    const picked = pickWallet({
      authenticated: true,
      wallets: [leftoverExternalWallet, embeddedWallet],
      explicitAddress: null,
    });
    // Embedded wallet MUST win over leftover external wallet
    expect(picked).toBe(embeddedWallet);
  });

  it("4. external chosen: returns external wallet when user purposefully connected it in this session", () => {
    const picked = pickWallet({
      authenticated: true,
      wallets: [embeddedWallet, chosenExternalWallet],
      explicitAddress: chosenExternalWallet.address,
    });
    expect(picked).toBe(chosenExternalWallet);
  });

  it("5. user changed: after switching accounts (explicitAddress cleared), returns embedded wallet of new account", () => {
    const newAccountEmbedded: WalletLike = {
      address: "0x4444444444444444444444444444444444444444",
      walletClientType: "privy",
    };
    // Prior session had chosenExternalWallet, but on user change explicitAddress was reset to null
    const picked = pickWallet({
      authenticated: true,
      wallets: [chosenExternalWallet, newAccountEmbedded],
      explicitAddress: null,
    });
    expect(picked).toBe(newAccountEmbedded);
  });

  it("6. external disconnected: falls back to embedded wallet if explicitly chosen external wallet was disconnected", () => {
    // User had chosen 0x3333..., but external wallet was disconnected so it's absent from wallets array
    const picked = pickWallet({
      authenticated: true,
      wallets: [embeddedWallet],
      explicitAddress: "0x3333333333333333333333333333333333333333",
    });
    expect(picked).toBe(embeddedWallet);
  });

  it("handles case-insensitive comparison for explicitAddress", () => {
    const picked = pickWallet({
      authenticated: true,
      wallets: [embeddedWallet, chosenExternalWallet],
      explicitAddress: chosenExternalWallet.address.toUpperCase(),
    });
    expect(picked).toBe(chosenExternalWallet);
  });
});
