import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { checkRecipient } from "./address";

const GOOD = "0x1111111111111111111111111111111111111111";
const MIXED = getAddress("0xa9ee28c80f960b889dfbd1902055218cba016f75");

describe("checkRecipient", () => {
  it("accepts lowercase, checksummed and padded-with-spaces-trimmed addresses", () => {
    expect(checkRecipient(GOOD).ok).toBe(true);
    expect(checkRecipient(MIXED).ok).toBe(true);
    expect(checkRecipient(`  ${GOOD}  `).ok).toBe(true);
  });

  it.each([
    ["", "Enter"],
    ["1111111111111111111111111111111111111111", "starts with 0x"],
    ["0x1234", "42 characters"],
    [GOOD + "1", "42 characters"],
    ["0x" + "g".repeat(40), "0-9 and letters a-f"],
    ["0x1111 111111111111111111111111111111111111", "spaces"],
    ["0x111111111111111111111111111111111111​1111", "hidden"],
  ])("rejects %j", (input, text) => {
    const r = checkRecipient(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain(text);
  });

  it("rejects a mistyped letter in a checksummed address", () => {
    const bad =
      MIXED.slice(0, 5) +
      (MIXED[5] === "A"
        ? "a"
        : MIXED[5]!.toUpperCase() === MIXED[5]
          ? MIXED[5]!.toLowerCase()
          : MIXED[5]!.toUpperCase()) +
      MIXED.slice(6);
    expect(bad).not.toBe(MIXED);
    expect(checkRecipient(bad).ok).toBe(false);
  });

  it("rejects the zero, burn, USDT, ShareGuard and own addresses", () => {
    for (const a of [
      "0x0000000000000000000000000000000000000000",
      "0x000000000000000000000000000000000000dEaD",
      "0x55d398326f99059fF775485246999027B3197955",
      "0x28F6F19bffbF25E36452c78d12090F0bC922970a",
    ])
      expect(checkRecipient(a).ok).toBe(false);
    expect(checkRecipient(GOOD, GOOD.toUpperCase().replace("0X", "0x")).ok).toBe(false);
  });
});
