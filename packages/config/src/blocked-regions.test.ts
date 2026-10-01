import { describe, expect, it } from "vitest";
import { BLOCKED_COUNTRIES, evaluateRegion } from "./blocked-regions";

describe("evaluateRegion", () => {
  it("blocks every hackathon country", () => {
    for (const code of ["US", "CA", "NL", "IR", "CU", "KP", "GB", "JP"]) {
      expect(evaluateRegion({ country: code }).blocked, code).toBe(true);
    }
  });
  it("allows South Korea and other unlisted countries", () => {
    for (const code of ["KR", "NG", "MX", "SG", "DE"]) {
      expect(evaluateRegion({ country: code }).blocked, code).toBe(false);
    }
  });
  it("is case and whitespace tolerant", () => {
    expect(evaluateRegion({ country: " us " }).blocked).toBe(true);
  });
  it("blocks unknown country and Tor", () => {
    expect(evaluateRegion({ country: "XX" })).toEqual({ blocked: true, reason: "unknown-country" });
    expect(evaluateRegion({ country: "T1" })).toEqual({ blocked: true, reason: "tor" });
  });
  it("fails closed when the header is missing, unless dev opts out", () => {
    expect(evaluateRegion({ country: undefined })).toEqual({
      blocked: true,
      reason: "missing-header",
    });
    expect(evaluateRegion({ country: null }, { allowMissingHeader: true }).blocked).toBe(false);
  });
  it("blocks Crimea, Donetsk and Luhansk when the region header is present", () => {
    for (const region of ["43", "40", "14", "09"]) {
      expect(evaluateRegion({ country: "UA", regionCode: region }).blocked, region).toBe(true);
    }
    expect(evaluateRegion({ country: "UA", regionCode: "30" }).blocked).toBe(false); // Kyiv city
    expect(evaluateRegion({ country: "UA" }).blocked).toBe(false); // limitation: no region data
  });
  it("records a source for every entry", () => {
    for (const c of BLOCKED_COUNTRIES) {
      expect(c.sources.length).toBeGreaterThan(0);
      expect(c.evidence).not.toBe("");
    }
  });
});
