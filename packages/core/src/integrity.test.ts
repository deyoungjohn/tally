import { describe, expect, it } from "vitest";
import { gradeFromScore, gradeIntegrity, type IntegrityInput } from "./integrity";
import { statusFromInfo } from "./status";

const open = statusFromInfo({ openState: true, marketStatus: "regular", reasonCode: "TRADING" });
const clean: IntegrityInput = {
  multiplierDisagree: false,
  premium: 0.0004,
  session: "regular",
  onchainVolume24hUsd: 5_000_000,
  status: open,
  unitTrap: false,
};

describe("integrity grade (blueprint §7.5)", () => {
  it("a clean token scores 100 / A with no reasons", () => {
    expect(gradeIntegrity(clean)).toMatchObject({ score: 100, grade: "A", reasons: [], flags: [] });
  });
  it("applies each deduction from the table", () => {
    expect(gradeIntegrity({ ...clean, multiplierDisagree: true }).score).toBe(75);
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
    expect(gradeIntegrity({ ...clean, attestationAgeDays: 4 }).score).toBe(90);
    expect(gradeIntegrity({ ...clean, attestationAgeDays: 3 }).score).toBe(100);
  });
  it("a premium over 2% only counts during regular hours", () => {
    expect(gradeIntegrity({ ...clean, premium: 0.05, session: "overnight" }).score).toBe(100);
  });
  it("unit trap is a badge, not points", () => {
    const g = gradeIntegrity({ ...clean, unitTrap: true });
    expect(g.score).toBe(100);
    expect(g.unitTrap).toBe(true);
    expect(g.flags).toContain("unit-trap");
  });
  it("a bounds violation is flagged without costing points (not in the table)", () => {
    const g = gradeIntegrity({ ...clean, boundsViolation: "multiplier decreased" });
    expect(g.score).toBe(100);
    expect(g.flags).toContain("bounds");
  });
  it("NVDAx as measured: disagreement + ghost volume → F, with plain-English reasons", () => {
    const g = gradeIntegrity({
      ...clean,
      multiplierDisagree: true,
      onchainVolume24hUsd: 96,
      premium: -0.2,
    });
    expect(g.score).toBe(5); // 100 − 25 − 40 − 30
    expect(g.grade).toBe("F");
    expect(g.flags).toEqual(
      expect.arrayContaining(["ghost", "multiplier-disagreement", "stale-price"]),
    );
    expect(g.reasons.every((r) => r.reason.length > 10)).toBe(true);
  });
  it("grade boundaries: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, else F", () => {
    expect(["A", "B", "C", "D", "F"]).toEqual([90, 75, 60, 40, 39].map(gradeFromScore));
    expect([89, 74, 59].map(gradeFromScore)).toEqual(["B", "C", "D"]);
  });
  it("never drops below zero", () => {
    expect(
      gradeIntegrity({
        ...clean,
        multiplierDisagree: true,
        premium: 1,
        onchainVolume24hUsd: 0,
        status: statusFromInfo({ reasonCode: "UNSUPPORTED" }),
        attestationAgeDays: 9,
      }).score,
    ).toBe(0);
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
    ).toBe("unknown"); // bStock: null session
  });
});
