import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tickerOf } from "./tickers";
import { fallbackLetter, iconFileFor } from "./token-icon-helpers";

describe("tickerOf", () => {
  const known = [{ ticker: "NVDA" }, { ticker: "ARKB" }, { ticker: "MSTX" }, { ticker: "ARK" }];
  it("strips the real issuer suffix", () => {
    expect(tickerOf("NVDAon", known)).toBe("NVDA");
    expect(tickerOf("NVDAB", known)).toBe("NVDA");
    expect(tickerOf("NVDAx", known)).toBe("NVDA");
  });
  it("keeps a ticker that itself ends in B or x, and prefers the longest match", () => {
    expect(tickerOf("ARKBon", known)).toBe("ARKB");
    expect(tickerOf("MSTXx", known)).toBe("MSTX");
    expect(tickerOf("ARKBB", known)).toBe("ARKB");
    expect(tickerOf("ARKBx", known)).toBe("ARKB");
  });
  it("returns an unknown symbol upper-cased and unchanged", () => {
    expect(tickerOf("usdt", known)).toBe("USDT");
    expect(tickerOf("ZZZZon", known)).toBe("ZZZZON");
  });
});

describe("icon lookup", () => {
  it("hits only tickers in the generated set", () => {
    const files = { NVDA: "NVDA.png" };
    expect(iconFileFor("NVDA", files)).toBe("NVDA.png");
    expect(iconFileFor("AAPL", files)).toBeUndefined();
    expect(iconFileFor("toString", files)).toBeUndefined();
  });
  it("letter fallback", () => {
    expect(fallbackLetter("nvda")).toBe("N");
    expect(fallbackLetter("USDT")).toBe("₮");
    expect(fallbackLetter("")).toBe("?");
  });
});

describe("pnpm tokens:icons checker", () => {
  const run = (dir: string) => {
    try {
      execFileSync("node", ["scripts/token-icons.mjs", "--check", dir], {
        cwd: join(__dirname, ".."),
        stdio: "pipe",
      });
      return { code: 0, err: "" };
    } catch (e) {
      const x = e as { status: number; stderr: Buffer };
      return { code: x.status, err: x.stderr.toString() };
    }
  };
  it("passes a 128 px PNG named like a ticker", () => {
    expect(run("test-fixtures/token-icons-good").code).toBe(0);
  });
  it("fails wrong size, bad name, not an image and over 10 KB", () => {
    const r = run("test-fixtures/token-icons-bad");
    expect(r.code).toBe(1);
    expect(r.err).toContain("WRONG.png: 64 x 64 must be 128 x 128");
    expect(r.err).toContain("good.png: name must look like");
    expect(r.err).toContain("FAKE.png: not a PNG or WebP");
    expect(r.err).toContain("BIG.png:");
    expect(r.err).toContain("over 10240");
  });
});
