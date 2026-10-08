import { describe, expect, it } from "vitest";
import { buildMigrateReceipt } from "./receipt-vm";

describe("MigrateReceiptVM", () => {
  it("computes conserved shares and dollar difference", () => {
    // conserved shares
    const vm = buildMigrateReceipt(
      {
        hash: "0x1",
        tokenSymbol: "NVDAB",
        isFixture: false,
        sellTokensSpent: "25400000000000000", // 0.0254
        multiplier: "1000000000000000000", // 1
        sellUsdtReceived: "1000000000000000000", // 1
        gasUsd: 0.1,
      },
      {
        hash: "0x2",
        tokenSymbol: "NVDAon",
        isFixture: false,
        buyTokensReceived: "254000000000000000", // 0.2540
        multiplier: "100000000000000000", // 0.1
        buyUsdtSpent: "1000000000000000000", // 1
        gasUsd: 0.15,
      },
    );

    expect(vm.giveUp.shares).toBe("0.0254");
    expect(vm.receive.shares).toBe("0.0254");
    expect(vm.shareDiff?.diff).toBe("+0");
    expect(vm.dollarDiff?.diff).toBe("-0.25");
  });
});
