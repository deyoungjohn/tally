import { describe, expect, it } from "vitest";
import { plainError } from "./errors";
import { outputJson } from "./output";

const missing = "BINANCE_W3_API_KEY and BINANCE_W3_API_SECRET are not set";
const untrusted =
  "private-diagnostic https://provider.invalid/private-path?context=private-diagnostic";
const auth = {
  kind: "auth",
  message:
    "Data-provider credentials are not set in this environment. Load the Tally API credentials, then retry. No transaction was sent.",
};

describe("plain authentication errors", () => {
  it("maps only the missing-credentials startup prefix and never echoes its diagnostic suffix", () => {
    const result = plainError(new Error(`${missing}. ${untrusted}`));
    expect(result).toEqual(auth);
    expect(outputJson(result)).not.toContain("private-diagnostic");
    expect(outputJson(result)).not.toMatch(/https?:|BINANCE_W3_API/);
  });
  it.each([new Error(untrusted), new Error(`Unrelated: ${missing}. ${untrusted}`)])(
    "keeps an unrelated error unavailable",
    (error) => {
      expect(plainError(error)).toEqual({
        kind: "unavailable",
        message: "Tally data is temporarily unavailable. No transaction was sent.",
      });
    },
  );
  it.each([
    [40103, "Request timestamp rejected: check this machine's clock"],
    ["40103", "Request timestamp rejected: check this machine's clock"],
    [40101, "API key or signature rejected"],
    ["40101", "API key or signature rejected"],
    [40102, "API key or signature rejected"],
    ["40102", "API key or signature rejected"],
  ])("maps auth code %s without echoing upstream content", (code, message) => {
    const result = plainError({ code, kind: "auth", message: untrusted });
    expect(result).toEqual({ kind: "auth", message });
    expect(outputJson(result)).not.toContain("private-diagnostic");
    expect(outputJson(result)).not.toMatch(/https?:/);
  });
});
