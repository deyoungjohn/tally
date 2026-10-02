import { describe, expect, it } from "vitest";
import {
  attestationAgeDays,
  gradeFromScore,
  gradeIntegrity,
  type IntegrityInput,
} from "./integrity";
import { resolveMultiplier } from "./multiplier";
import { statusFromInfo } from "./status";
import { parseDecimal } from "./units";

const m = (s: string) => parseDecimal(s, 18);
const open = statusFromInfo({ openState: true, marketStatus: "regular", reasonCode: "TRADING" });
const NOW = Date.UTC(2026, 9, 2, 5, 26); // 2026-10-02 05:26 UTC
const agree = { api: m("1.0017"), list: m("1.0017") };
const clean: IntegrityInput = {
  multiplier: resolveMultiplier("ondo", agree),
  readings: agree,
  bounds: { outcome: "pass", detail: "1.0017 vs baseline 1.0017 (seen 2026-09-30): unchanged" },
  premium: 0.0004,
  premiumBasis: "quote",
  session: "regular",
  onchainVolume24hUsd: 5_000_000,
  status: open,
  attestation: { reportDate: "2026-10-01", url: "https://x/daily-2026-10-01.pdf" },
  now: NOW,
  unitTrap: false,
};
const withDisagree = (): IntegrityInput => {
  const readings = { onchain: m("1.001701196801074"), api: m("1.0009180758490996"), list: m("1") };
  return {
    ...clean,
    readings,
    multiplier: resolveMultiplier("xstocks", readings),
    bounds: undefined,
  };
};
const id = (g: ReturnType<typeof gradeIntegrity>, c: string) => g.checks.find((x) => x.id === c)!;

describe("integrity grade (blueprint §7.5)", () => {
  it("a clean token scores 100 / A and has no deductions", () => {
    const g = gradeIntegrity(clean);
    expect(g).toMatchObject({ score: 100, grade: "A", flags: [], reasons: [] });
  });
  it("applies each deduction from the table", () => {
    expect(gradeIntegrity(withDisagree()).score).toBe(75);
    expect(gradeIntegrity({ ...clean, premium: 0.05 }).score).toBe(70);
    expect(gradeIntegrity({ ...clean, premium: -0.05 }).score).toBe(70);
    expect(gradeIntegrity({ ...clean, onchainVolume24hUsd: 96 }).score).toBe(60);
    expect(gradeIntegrity({ ...clean, status: null }).score).toBe(90);
    expect(
      gradeIntegrity({
        ...clean,
        status: statusFromInfo({
          reasonCode: "MARKET_PAUSED",
          reasonMsg: "Paused for session transition",
        }),
      }).score,
    ).toBe(50);
    expect(
      gradeIntegrity({ ...clean, status: statusFromInfo({ reasonCode: "ASSET_LIMITED" }) }).score,
    ).toBe(90);
  });
  it("a premium over 2% only counts during regular hours", () => {
    const g = gradeIntegrity({ ...clean, premium: 0.05, session: "overnight" });
    expect(g.score).toBe(100);
    expect(id(g, "premium").outcome).toBe("skipped");
  });
  it("unit trap is a badge, not points", () => {
    const g = gradeIntegrity({ ...clean, unitTrap: true });
    expect(g.score).toBe(100);
    expect(g.flags).toContain("unit-trap");
    expect(id(g, "unit-trap")).toMatchObject({ outcome: "flag", points: 0 });
  });
  it("a bounds failure is flagged and blocks, without costing points (not in the table)", () => {
    const g = gradeIntegrity({
      ...clean,
      bounds: { outcome: "fail", detail: "1.001 vs baseline 1.0017 (seen 2026-09-30): decreased" },
    });
    expect(g.score).toBe(100);
    expect(g.flags).toContain("bounds");
    expect(id(g, "ondo-bounds").summary).toMatch(/decreased.*blocks execution/);
  });
  it("NVDAx as measured: disagreement + ghost volume + stale listing → F, with plain-English reasons", () => {
    const g = gradeIntegrity({
      ...withDisagree(),
      onchainVolume24hUsd: 96,
      premium: -0.2,
      premiumBasis: "listed price",
    });
    expect(g.score).toBe(5); // 100 − 25 − 40 − 30
    expect(g.grade).toBe("F");
    expect(g.flags).toEqual(
      expect.arrayContaining(["ghost", "multiplier-disagreement", "stale-price"]),
    );
    expect(g.reasons.every((r) => r.reason!.length > 10)).toBe(true);
  });
  it("grade boundaries: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, else F", () => {
    expect([90, 75, 60, 40, 39].map(gradeFromScore)).toEqual(["A", "B", "C", "D", "F"]);
    expect([89, 74, 59].map(gradeFromScore)).toEqual(["B", "C", "D"]);
  });
  it("never drops below zero", () => {
    const g = gradeIntegrity({
      ...withDisagree(),
      premium: 1,
      onchainVolume24hUsd: 0,
      status: statusFromInfo({ reasonCode: "UNSUPPORTED" }),
      attestation: { reportDate: "2026-01-01", url: "u" },
    });
    expect(g.score).toBe(0);
  });
});

describe("the integrity log records EVERY check, passes and skips included", () => {
  it("always writes all seven checks in a fixed order", () => {
    for (const input of [
      clean,
      { ...clean, status: null, attestation: undefined },
      withDisagree(),
    ]) {
      expect(gradeIntegrity(input).checks.map((c) => c.id)).toEqual([
        "multiplier-sources",
        "ondo-bounds",
        "premium",
        "onchain-volume",
        "status",
        "attestation",
        "unit-trap",
      ]);
    }
  });
  it("the score is exactly 100 minus the points in the log", () => {
    const g = gradeIntegrity({ ...withDisagree(), onchainVolume24hUsd: 96, status: null });
    expect(g.score).toBe(100 - g.checks.reduce((s, c) => s + c.points, 0));
  });
  it("a pass says what it compared: 'report 2026-10-01, age 1.2d ≤ 3d → pass'", () => {
    expect(id(gradeIntegrity(clean), "attestation")).toMatchObject({
      outcome: "pass",
      points: 0,
      summary: "report 2026-10-01, age 1.2d ≤ 3d → pass",
    });
  });
  it("the 2026-10-02 probe: report 2026-09-29 at 05:26 UTC is 3.2 days old → −10, and the log says so", () => {
    const g = gradeIntegrity({
      ...clean,
      attestation: { reportDate: "2026-09-29", url: "https://x/daily-2026-09-29.pdf" },
    });
    expect(id(g, "attestation")).toMatchObject({
      outcome: "deduct",
      points: 10,
      summary: "report 2026-09-29, age 3.2d > 3d → −10",
    });
    expect(id(g, "attestation").inputs).toMatchObject({ reportDate: "2026-09-29", ageDays: 3.23 });
    expect(g.score).toBe(90);
    expect(g.reasons.map((r) => r.reason).join()).toMatch(/attestation is 3 days old/);
  });
  it("the age threshold is calendar days, strictly greater than 3: exactly 3.0d passes", () => {
    expect(attestationAgeDays({ reportDate: "2026-09-29", url: "" }, Date.UTC(2026, 9, 2))).toBe(3);
    expect(
      id(
        gradeIntegrity({
          ...clean,
          attestation: { reportDate: "2026-09-29", url: "" },
          now: Date.UTC(2026, 9, 2),
        }),
        "attestation",
      ).outcome,
    ).toBe("pass");
  });
  it("a missing attestation is 'skipped' WITH the reason, not silently a clean score", () => {
    const empty = gradeIntegrity({
      ...clean,
      attestation: undefined,
      notes: { attestation: "no dated daily report (protections: collateralReport)" },
    });
    expect(id(empty, "attestation")).toMatchObject({
      outcome: "skipped",
      points: 0,
      summary: "no dated daily report (protections: collateralReport) → skipped",
    });
    const failed = gradeIntegrity({
      ...clean,
      attestation: undefined,
      notes: { attestation: "underlying-profile failed: Rate limit exceeded" },
    });
    expect(id(failed, "attestation").summary).toBe(
      "underlying-profile failed: Rate limit exceeded → skipped",
    );
    expect(id(gradeIntegrity({ ...clean, attestation: undefined }), "attestation").summary).toBe(
      "no attestation data → skipped",
    );
  });
  it("unknown volume is skipped with its reason; known volume logs the dollars", () => {
    expect(
      id(
        gradeIntegrity({
          ...clean,
          onchainVolume24hUsd: undefined,
          notes: { volume: "token dynamic call failed: 403" },
        }),
        "onchain-volume",
      ).summary,
    ).toBe("volume unknown (token dynamic call failed: 403) → skipped, ghost check not run");
    expect(id(gradeIntegrity(clean), "onchain-volume").summary).toBe(
      "$5,000,000 in 24h ≥ $1,000 → pass",
    );
    expect(
      id(gradeIntegrity({ ...clean, onchainVolume24hUsd: 96 }), "onchain-volume").summary,
    ).toBe("$96 in 24h < $1,000 → −40");
  });
  it("the multiplier check logs every source reading, and the deviation", () => {
    const g = gradeIntegrity(withDisagree());
    expect(id(g, "multiplier-sources").summary).toBe(
      "onchain 1.001701, api 1.000918, list 1; max difference 1701 ppm > 1000 → −25",
    );
    expect(id(gradeIntegrity(clean), "multiplier-sources").summary).toMatch(
      /max difference 0 ppm ≤ 1000, using api → pass/,
    );
  });
  it("bounds: not applicable for on-chain issuers, otherwise the bounds detail is logged", () => {
    expect(id(gradeIntegrity({ ...clean, bounds: undefined }), "ondo-bounds").summary).toMatch(
      /not applicable.*skipped/,
    );
    expect(id(gradeIntegrity(clean), "ondo-bounds").summary).toBe(
      "1.0017 vs baseline 1.0017 (seen 2026-09-30): unchanged → pass",
    );
    expect(
      id(
        gradeIntegrity({
          ...clean,
          bounds: {
            outcome: "skipped",
            detail: "1.0017: no baseline for this token, only checked for sanity",
          },
        }),
        "ondo-bounds",
      ).outcome,
    ).toBe("skipped");
  });
  it("status unknown logs why", () => {
    expect(
      id(
        gradeIntegrity({
          ...clean,
          status: null,
          notes: { status: "not in the authenticated list" },
        }),
        "status",
      ).summary,
    ).toBe("status unknown (not in the authenticated list) → −10");
  });
});

describe("status mapping", () => {
  it("null info is unknown, never open", () => {
    expect(statusFromInfo(null)).toBeNull();
    expect(statusFromInfo(undefined)).toBeNull();
  });
  it("maps the reason codes seen in the recorded list", () => {
    expect(
      statusFromInfo({ openState: true, marketStatus: "overnight", reasonCode: "TRADING" }),
    ).toMatchObject({ kind: "open", session: "overnight" });
    expect(
      statusFromInfo({
        marketStatus: "paused",
        reasonCode: "MARKET_PAUSED",
        reasonMsg: "Paused for session transition",
      }),
    ).toMatchObject({ kind: "paused", session: "unknown" });
    expect(statusFromInfo({ reasonCode: "UNSUPPORTED" })?.kind).toBe("unsupported");
    expect(statusFromInfo({ openState: false, reasonCode: "TRADING" })?.kind).toBe("paused");
    expect(statusFromInfo({ reasonCode: "SOMETHING_NEW" })?.kind).toBe("unknown");
    expect(
      statusFromInfo({ openState: true, marketStatus: null, reasonCode: "TRADING" })?.session,
    ).toBe("unknown");
  });
});
