import { describe, expect, it } from "vitest";
import { buildMigrateReceipt } from "./receipt-vm";
import { parseUnits } from "viem";

describe("MigrateReceiptVM", () => {
  it("conserved: computes conserved shares and dollar difference", () => {
    const vm = buildMigrateReceipt(
      {
        hash: "0x1",
        tokenSymbol: "NVDAB",
        isFixture: false,
        sellTokensSpent: parseUnits("0.0254", 18).toString(),
        multiplier: parseUnits("1", 18).toString(),
        sellUsdtReceived: parseUnits("1", 18).toString(),
        gasUsd: 0.1,
      },
      {
        hash: "0x2",
        tokenSymbol: "NVDAon",
        isFixture: false,
        buyTokensReceived: parseUnits("0.2540", 18).toString(),
        multiplier: parseUnits("0.1", 18).toString(),
        buyUsdtSpent: parseUnits("1", 18).toString(),
        gasUsd: 0.15,
      }
    );

    expect(vm.giveUp.shares).toBe("0.0254");
    expect(vm.receive.shares).toBe("0.0254");
    expect(vm.shareDiff?.diff).toBe("+0");
    expect(vm.dollarDiff?.diff).toBe("+$0.00 (minus $0.25 gas)");
    expect(vm.dollarDiff?.isDown).toBe(false);
  });

  it("down: computes share down and dollar down", () => {
    const vm = buildMigrateReceipt(
      {
        hash: "0x1",
        tokenSymbol: "NVDAB",
        isFixture: false,
        sellTokensSpent: parseUnits("0.0254", 18).toString(),
        multiplier: parseUnits("1", 18).toString(),
        sellUsdtReceived: parseUnits("100", 18).toString(), // Received $100
        gasUsd: 0.1,
      },
      {
        hash: "0x2",
        tokenSymbol: "NVDAon",
        isFixture: false,
        buyTokensReceived: parseUnits("0.2500", 18).toString(), // Got less shares
        multiplier: parseUnits("0.1", 18).toString(),
        buyUsdtSpent: parseUnits("102", 18).toString(), // Spent $102
        gasUsd: 0.15,
      }
    );

    expect(vm.giveUp.shares).toBe("0.0254");
    expect(vm.receive.shares).toBe("0.025");
    expect(vm.shareDiff?.diff).toBe("-0.0004");
    expect(vm.dollarDiff?.diff).toBe("-$2.00 (minus $0.25 gas)");
    expect(vm.dollarDiff?.isDown).toBe(true);
  });

  it("up: computes share up and dollar up", () => {
    const vm = buildMigrateReceipt(
      {
        hash: "0x1",
        tokenSymbol: "NVDAB",
        isFixture: false,
        sellTokensSpent: parseUnits("0.0254", 18).toString(),
        multiplier: parseUnits("1", 18).toString(),
        sellUsdtReceived: parseUnits("102", 18).toString(), // Received $102
      },
      {
        hash: "0x2",
        tokenSymbol: "NVDAon",
        isFixture: false,
        buyTokensReceived: parseUnits("0.2600", 18).toString(),
        multiplier: parseUnits("0.1", 18).toString(),
        buyUsdtSpent: parseUnits("100", 18).toString(), // Spent $100
      }
    );

    expect(vm.giveUp.shares).toBe("0.0254");
    expect(vm.receive.shares).toBe("0.026");
    expect(vm.shareDiff?.diff).toBe("+0.0006");
    expect(vm.dollarDiff?.diff).toBe("+$2.00");
    expect(vm.dollarDiff?.isDown).toBe(false);
  });

  it("missing multiplier: no share difference", () => {
    const vm = buildMigrateReceipt(
      {
        hash: "0x1",
        tokenSymbol: "NVDAB",
        isFixture: false,
        sellTokensSpent: parseUnits("0.0254", 18).toString(),
        multiplier: undefined,
        sellUsdtReceived: parseUnits("100", 18).toString(),
      },
      {
        hash: "0x2",
        tokenSymbol: "NVDAon",
        isFixture: false,
        buyTokensReceived: parseUnits("0.2540", 18).toString(),
        multiplier: parseUnits("0.1", 18).toString(),
        buyUsdtSpent: parseUnits("100", 18).toString(),
      }
    );

    expect(vm.giveUp.shares).toBe(null);
    expect(vm.receive.shares).toBe("0.0254");
    expect(vm.shareDiff).toBe(null);
  });

  it("unverified leg: missing sale tokens", () => {
    const vm = buildMigrateReceipt(
      {
        hash: "0x1",
        tokenSymbol: "NVDAB",
        isFixture: false,
        sellTokensSpent: undefined, // unverified!
        multiplier: parseUnits("1", 18).toString(),
        sellUsdtReceived: undefined,
      },
      {
        hash: "0x2",
        tokenSymbol: "NVDAon",
        isFixture: false,
        buyTokensReceived: parseUnits("0.2540", 18).toString(),
        multiplier: parseUnits("0.1", 18).toString(),
        buyUsdtSpent: parseUnits("100", 18).toString(),
      }
    );

    expect(vm.giveUp.verified).toBe(false);
    expect(vm.giveUp.shares).toBe(null);
    expect(vm.shareDiff).toBe(null);
    expect(vm.dollarDiff).toBe(null);
  });

  it("old stored shape: handles legacy fields gracefully", () => {
    const vm = buildMigrateReceipt(
      {
        hash: "0x1",
        tokenSymbol: "NVDAB",
        isFixture: false,
        sellTokensSpent: parseUnits("0.0254", 18).toString(),
        multiplier: parseUnits("1", 18).toString(),
        sellUsdtReceived: parseUnits("100", 18).toString(),
        // plan might not have simulation
        plan: {
          route: "0x",
          vendor: "Tally",
          quoteTime: 1234567890,
          simulation: null,
        }
      },
      {
        hash: "0x2",
        tokenSymbol: "NVDAon",
        isFixture: false,
        buyTokensReceived: parseUnits("0.2540", 18).toString(),
        multiplier: parseUnits("0.1", 18).toString(),
        buyUsdtSpent: parseUnits("100", 18).toString(),
        plan: {
          route: "0x",
          vendor: "Tally",
          quoteTime: 1234567890,
          simulation: null,
        }
      }
    );

    expect(vm.giveUp.simulation).toBe(null);
    expect(vm.receive.simulation).toBe(null);
    expect(vm.shareDiff?.diff).toBe("+0");
  });
});
