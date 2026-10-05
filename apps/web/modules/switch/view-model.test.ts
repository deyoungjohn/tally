import { describe, expect, it } from "vitest";
import { loadSellSheet, loadSwitch, loadSwitchSheet } from "./view-model";

describe("switch module view models", () => {
  it("empty switch view model explains missing observations and never claims a live source", async () => {
    expect(await loadSwitch()).toEqual({
      state: "empty",
      stale: false,
      ageMs: null,
      source: null,
      reason: "Switch has no observations yet.",
      error: null,
    });
  });

  it("empty sell sheet prompts for share amount", async () => {
    const vm = await loadSellSheet();
    expect(vm.state).toBe("empty");
    expect(vm.availabilityReason).toBe("Enter a share amount to sell.");
    expect(vm.sharesIn).toBe("0");
    expect(vm.minUsdtFloor).toBe("0");
  });

  it("ready sell sheet provides floor, quoted USDT, fee and integrity grade", async () => {
    const vm = await loadSellSheet({
      ticker: "NVDA",
      issuer: "bstock",
      shares: 0.025,
      user: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
    });

    expect(vm.state).toBe("ready");
    expect(vm.ticker).toBe("NVDA");
    expect(vm.issuer).toBe("bstock");
    expect(vm.symbol).toBe("NVDAB");
    expect(BigInt(vm.minUsdtFloor)).toBeGreaterThan(0n);
    expect(BigInt(vm.quotedUsdtOut)).toBeGreaterThan(BigInt(vm.minUsdtFloor));
    expect(vm.integrityGrade).toBe("A");
    expect(vm.usdPerShare).toBeGreaterThan(0);
    expect(vm.error).toBeNull();
  });

  it("switch sheet returns two_step or empty without claiming false atomicity", async () => {
    const emptyVm = await loadSwitchSheet();
    expect(emptyVm.state).toBe("empty");

    const vm = await loadSwitchSheet({
      ticker: "NVDA",
      fromIssuer: "ondo",
      toIssuer: "bstock",
      shares: 0.026,
      user: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
    });

    expect(vm.state).toBe("two_step");
    expect(vm.twoStepRequired).toBe(true);
    expect(vm.directRoute).toBe(false);
    expect(vm.availabilityReason).toContain("Gate V-B1");
    expect(vm.destinationFloorShares).toBeTruthy();
  });
});
