import { describe, expect, it } from "vitest";
import { createGuardianSettingsSchema, saveGuardianSettings } from "./settings";
import { DEFAULT_GUARDIAN_SETTINGS } from "./types";
import { openStore } from "@tally/modkit";

describe("Guardian settings validation", () => {
  const schema = createGuardianSettingsSchema(new Set(["AAPL", "TSLA"]));

  it("accepts valid default settings", () => {
    expect(schema.parse(DEFAULT_GUARDIAN_SETTINGS)).toEqual(DEFAULT_GUARDIAN_SETTINGS);
  });

  it("rejects unknown fields", () => {
    const input = { ...DEFAULT_GUARDIAN_SETTINGS, unknownField: true };
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects earnings: true", () => {
    const input = {
      ...DEFAULT_GUARDIAN_SETTINGS,
      rules: { ...DEFAULT_GUARDIAN_SETTINGS.rules, earnings: true },
    };
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.issues[0]?.message).toBe("No earnings-date source is available yet");
    }
  });

  it("accepts valid price thresholds", () => {
    const input = {
      ...DEFAULT_GUARDIAN_SETTINGS,
      priceThresholds: {
        AAPL: { minPriceUsd: 100, maxPriceUsd: 200 },
      },
    };
    expect(schema.parse(input)).toEqual(input);
  });

  it("rejects minPrice >= maxPrice", () => {
    const input = {
      ...DEFAULT_GUARDIAN_SETTINGS,
      priceThresholds: {
        AAPL: { minPriceUsd: 200, maxPriceUsd: 100 },
      },
    };
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects invalid tickers", () => {
    const input = {
      ...DEFAULT_GUARDIAN_SETTINGS,
      priceThresholds: {
        INVALID: { minPriceUsd: 100, maxPriceUsd: 200 },
      },
    };
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects over 20 tickers", () => {
    const manyTickers = new Set<string>();
    const priceThresholds: Record<string, unknown> = {};
    for (let i = 0; i < 21; i++) {
      manyTickers.add(`TICKER${i}`);
      priceThresholds[`TICKER${i}`] = { minPriceUsd: 100 };
    }
    const wideSchema = createGuardianSettingsSchema(manyTickers);
    const input = { ...DEFAULT_GUARDIAN_SETTINGS, priceThresholds };
    const result = wideSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts valid quiet hours and cooldown", () => {
    const input = {
      ...DEFAULT_GUARDIAN_SETTINGS,
      quietHours: { enabled: true, startHourUtc: 0, endHourUtc: 23 },
      cooldownMs: 900_000,
    };
    expect(schema.parse(input)).toEqual(input);
  });

  it("rejects invalid quiet hours and cooldown", () => {
    const input = {
      ...DEFAULT_GUARDIAN_SETTINGS,
      quietHours: { enabled: true, startHourUtc: -1, endHourUtc: 24 },
      cooldownMs: 800_000,
    };
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("saveGuardianSettings", () => {
  it("saves the setting to the snapshot store", () => {
    const store = openStore(":memory:");
    try {
      saveGuardianSettings(store, "0x123", DEFAULT_GUARDIAN_SETTINGS, 1000);
      const row = store.latest("guardian-settings", "0x123", { maxAgeMs: 100000, now: 1000 });
      expect(row?.data).toEqual(DEFAULT_GUARDIAN_SETTINGS);
      expect(row?.source).toBe("web-session");

      // Address must be lowercased
      const rowUpper = store.latest("guardian-settings", "0X123", { maxAgeMs: 100000, now: 1000 });
      expect(rowUpper).toBeNull(); // wait, we request lowercase because key is lowercased, wait: latest("guardian-settings", "0X123") checks key "0X123" which shouldn't exist because we saved it as lowercase "0x123"
    } finally {
      store.close();
    }
  });
});
