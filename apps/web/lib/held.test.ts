import { describe, expect, it } from "vitest";
import { heldQuery } from "./held";

const g = (ticker: string, valueUsd: number | null) =>
  ({ ticker, valueUsd }) as unknown as Parameters<typeof heldQuery>[0] extends infer T
    ? T extends { groups: (infer G)[] }
      ? G
      : never
    : never;

describe("heldQuery", () => {
  it("lists the stocks held right now, once each, and skips dust", () => {
    const chain = { groups: [g("NVDA", 20), g("NVDA", 5), g("AAPL", 0.4), g("TSLA", null)] };
    expect(heldQuery(chain)).toBe("&held=NVDA%2CTSLA");
  });
  it("sends an empty list when nothing is held, so suggestions come back at once after selling everything", () => {
    expect(heldQuery({ groups: [] })).toBe("&held=");
  });
  it("sends nothing until the chain read has arrived", () => {
    expect(heldQuery(null)).toBe("");
  });
});
