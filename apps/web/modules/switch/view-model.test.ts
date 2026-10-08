import { describe, expect, it } from "vitest";
import { loadMigrate, loadMigrateSheet } from "./view-model";

describe("migrate module view models", () => {
  it("empty migrate view model explains missing observations", async () => {
    expect(await loadMigrate()).toEqual({
      reason: "Migrate has no observations yet.",
    });
  });

  it("empty migrate sheet returns honest empty state", async () => {
    const vm = await loadMigrateSheet();
    expect(vm.state).toBe("empty");
    expect(vm.eligible).toBe(true);
    expect(vm.availabilityReason).toBeNull();
    expect(vm.sharesIn).toBeNull();
  });

  it("migrate sheet with ineligible xstocks source is blocked", async () => {
    const vm = await loadMigrateSheet({
      ticker: "NVDA",
      fromIssuer: "xstocks",
      user: "0x123",
    });

    expect(vm.state).toBe("empty");
    expect(vm.eligible).toBe(false);
    expect(vm.availabilityReason).toBe("No market to exit this token on BNB Chain");
  });

  it("migrate sheet with unbuyable destination is blocked", async () => {
    const vm = await loadMigrateSheet({
      ticker: "DJT", // Not in the enabled manifest.
      fromIssuer: "ondo",
      toIssuer: "bstock",
      user: "0x123",
    });

    expect(vm.state).toBe("empty");
    expect(vm.eligible).toBe(false);
    expect(vm.availabilityReason).toBe("DJTB isn’t enabled in Tally yet");
  });

  it.each([
    ["NFLX", "ondo", "bstock", "NFLXB"],
    ["MSFT", "bstock", "ondo", "MSFTon"],
  ] as const)(
    "blocks %s migration into its disabled issuer",
    async (ticker, fromIssuer, toIssuer, symbol) => {
      const vm = await loadMigrateSheet({
        ticker,
        fromIssuer,
        toIssuer,
        user: "0x123",
        sellQuotedUsdt: "6500000000000000000",
      });
      expect(vm.state).toBe("empty");
      expect(vm.eligible).toBe(false);
      expect(vm.toSymbol).toBe(symbol);
      expect(vm.availabilityReason).toBe(`${symbol} isn’t enabled in Tally yet`);
    },
  );

  it.each([
    ["NFLX", "bstock", "ondo", "NFLXon"],
    ["MSFT", "ondo", "bstock", "MSFTB"],
    ["NVDA", "ondo", "bstock", "NVDAB"],
    ["NVDA", "bstock", "ondo", "NVDAon"],
  ] as const)(
    "allows %s migration to enabled %s → %s",
    async (ticker, fromIssuer, toIssuer, symbol) => {
      const vm = await loadMigrateSheet({
        ticker,
        fromIssuer,
        toIssuer,
        user: "0x123",
        sellQuotedUsdt: "6500000000000000000",
      });
      expect(vm.state).toBe("ready");
      expect(vm.eligible).toBe(true);
      expect(vm.toSymbol).toBe(symbol);
      expect(vm.availabilityReason).toBeNull();
    },
  );

  it("migrate sheet under 6 USDT is blocked", async () => {
    const vm = await loadMigrateSheet({
      ticker: "NVDA",
      fromIssuer: "ondo",
      toIssuer: "bstock",
      sellQuotedUsdt: "5999999999999999999",
      user: "0x123",
    });

    expect(vm.state).toBe("empty");
    expect(vm.eligible).toBe(false);
    expect(vm.availabilityReason).toBe(
      "Too small to migrate: the buy needs at least 6 USDT. You can sell to USDT instead.",
    );
  });

  it("migrate sheet ready with valid params", async () => {
    const vm = await loadMigrateSheet({
      ticker: "NVDA",
      fromIssuer: "ondo",
      toIssuer: "bstock",
      sellQuotedUsdt: "6500000000000000000",
      user: "0x123",
      shares: 10,
    });

    expect(vm.state).toBe("ready");
    expect(vm.eligible).toBe(true);
    expect(vm.availabilityReason).toBeNull();
    expect(vm.fromSymbol).toBe("NVDAon");
    expect(vm.toSymbol).toBe("NVDAB");
    expect(vm.sharesIn).toBe("10");
  });
});
