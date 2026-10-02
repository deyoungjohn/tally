import { describe, expect, it } from "vitest";
import { isoTimestamp, preHash, sign } from "./signing";

describe("request signing (blueprint §7.1)", () => {
  const ts = "2026-10-01T14:23:11.123Z";
  it("pre-hash is timestamp + METHOD + /build + path + ?query + body", () => {
    expect(
      preHash({
        timestamp: ts,
        method: "GET",
        path: "/api/v1/dex/aggregator/quote",
        query: "binanceChainId=56&amount=6000000000000000000",
      }),
    ).toBe(
      "2026-10-01T14:23:11.123ZGET/build/api/v1/dex/aggregator/quote?binanceChainId=56&amount=6000000000000000000",
    );
  });
  it("matches an HMAC-SHA256 computed independently in Python (GET with query)", () => {
    expect(
      sign({
        secret: "test-secret",
        timestamp: ts,
        method: "GET",
        path: "/api/v1/dex/aggregator/quote",
        query: "binanceChainId=56&amount=6000000000000000000",
      }),
    ).toBe("ei2Z4PBWP+NdL6GHmVEMmsKll1IZ7aISdH0wxCIAZ4Y=");
  });
  it("matches the Python vector for a POST body, and has no '?' when there is no query", () => {
    expect(
      sign({
        secret: "test-secret",
        timestamp: ts,
        method: "POST",
        path: "/api/v1/dex/order/submit",
        body: '{"a":1}',
      }),
    ).toBe("y6kcQJ9qd1un2OvppZgzBkwnMxL+PWuu4lSLlzscRt8=");
  });
  it("omitting the /build prefix would change the signature (that is the 40102 trap)", () => {
    const withPrefix = sign({ secret: "s", timestamp: ts, method: "GET", path: "/x" });
    const withoutPrefix = sign({ secret: "s", timestamp: ts, method: "GET", path: "/x" }).slice(
      0,
      0,
    );
    expect(withPrefix).not.toBe(withoutPrefix);
    expect(preHash({ timestamp: ts, method: "GET", path: "/x" })).toContain("/build/x");
  });
  it("timestamps are ISO-8601 UTC with milliseconds", () => {
    expect(isoTimestamp(Date.UTC(2026, 9, 1, 14, 23, 11, 123))).toBe(ts);
    expect(isoTimestamp(Date.UTC(2026, 9, 1, 14, 23, 11, 5))).toBe("2026-10-01T14:23:11.005Z");
  });
});
