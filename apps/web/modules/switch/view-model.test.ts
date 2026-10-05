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

  it("empty sell sheet returns honest empty state without invented numbers", async () => {
    const vm = await loadSellSheet();
    expect(vm.state).toBe("empty");
    expect(vm.availabilityReason).toBe(
      "A sell plan needs a live quote; open a sell from the Portfolio.",
    );
    expect(vm.sharesIn).toBe("0");
    expect(vm.quotedUsdtOut).toBe("0");
    expect(vm.minUsdtFloor).toBe("0");
    expect(vm.source).toBeNull();
  });

  it("sell sheet with params preserves honest empty state", async () => {
    const vm = await loadSellSheet({
      ticker: "NVDA",
      issuer: "bstock",
      shares: 0.025,
      user: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
    });

    expect(vm.state).toBe("empty");
    expect(vm.ticker).toBe("NVDA");
    expect(vm.issuer).toBe("bstock");
    expect(vm.symbol).toBe("NVDAB");
    expect(vm.minUsdtFloor).toBe("0");
    expect(vm.quotedUsdtOut).toBe("0");
    expect(vm.source).toBeNull();
    expect(vm.error).toBeNull();
  });

  it("max sell sheet retains raw token balance in honest empty state", async () => {
    const vm = await loadSellSheet({
      ticker: "NVDA",
      issuer: "bstock",
      max: true,
      rawBalance: "49999999999999999",
      user: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
    });

    expect(vm.state).toBe("empty");
    expect(vm.isMax).toBe(true);
    expect(vm.tokensIn).toBe("49999999999999999");
    expect(vm.source).toBeNull();
  });

  it("switch sheet returns honest empty state explaining upstream pair limitation without claiming false atomicity", async () => {
    const emptyVm = await loadSwitchSheet();
    expect(emptyVm.state).toBe("empty");
    expect(emptyVm.availabilityReason).toContain("code 40368");
    expect(emptyVm.sharesIn).toBe("0");
    expect(emptyVm.sharesOut).toBe("0");
    expect(emptyVm.source).toBeNull();

    const vm = await loadSwitchSheet({
      ticker: "NVDA",
      fromIssuer: "ondo",
      toIssuer: "bstock",
      shares: 0.026,
      user: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
    });

    expect(vm.state).toBe("empty");
    expect(vm.twoStepRequired).toBe(false);
    expect(vm.directRoute).toBe(false);
    expect(vm.availabilityReason).toContain("code 40368");
    expect(vm.destinationFloorShares).toBe("0");
    expect(vm.source).toBeNull();
  });
});
