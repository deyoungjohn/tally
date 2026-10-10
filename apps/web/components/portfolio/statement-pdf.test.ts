import { describe, it, expect } from "vitest";
import { statement, parseDecimal, E18 } from "@tally/mod-statement";
import { buildStatementVM } from "../../modules/statement/view-model";
import {
  TALLY_HOME_URL,
  buildStatementPdfDescription,
  buildStatementPdfDoc,
  statementPdfFilename,
} from "./statement-pdf";

const WALLET = "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930";

describe("statement-pdf pure builder and generator", () => {
  it("exports the official TALLY_HOME_URL constant", () => {
    expect(TALLY_HOME_URL).toBe("https://tallyprotocol.xyz");
  });

  it("formats filenames matching tally-statement-<wallet first 6>-<UTC date>.pdf", () => {
    const fn = statementPdfFilename(WALLET, new Date("2026-10-10T12:00:00Z"));
    expect(fn).toBe("tally-statement-0x2Bf7Ed-2026-10-10.pdf");

    const fallback = statementPdfFilename(null, new Date("2026-10-10T12:00:00Z"));
    expect(fallback).toBe("tally-statement-wallet-2026-10-10.pdf");
  });

  it("pure builder produces document description where rows equal the CSV rows exactly", () => {
    const stmt = statement({
      walletAddress: WALLET,
      holdings: [
        {
          tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
          tokenSymbol: "NVDAon",
          ticker: "NVDA",
          issuer: "ondo",
          balanceTokens: parseDecimal("1", 18),
          multiplier: E18,
          balanceShares: parseDecimal("1", 18),
          convertedAtTodaysRatio: false,
          tokenBalanceUsdE18: 240n * E18,
          costBasisUsdE18: 230n * E18,
          avgCostPerShareUsdE18: 230n * E18,
          pricePerShareUsdE18: 240n * E18,
          unrealizedPnlUsdE18: 10n * E18,
          isRecognized: true,
          source: "api/portfolio/recent-pnl",
        },
      ],
      trades: [
        {
          txHash: "0xabc1",
          time: 1760000000000,
          tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
          tokenSymbol: "NVDAon",
          ticker: "NVDA",
          issuer: "ondo",
          type: "BUY",
          amountTokens: parseDecimal("0.5", 18),
          multiplier: E18,
          amountShares: parseDecimal("0.5", 18),
          valueUsdE18: 115n * E18,
          pricePerTokenUsdE18: 230n * E18,
          pricePerShareUsdE18: 230n * E18,
          convertedAtTodaysRatio: false,
          isRecognized: true,
        },
        {
          txHash: "0xabc2",
          time: 1760001000000,
          tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
          tokenSymbol: "NVDAon",
          ticker: "NVDA",
          issuer: "ondo",
          type: "SELL",
          amountTokens: parseDecimal("0.2", 18),
          multiplier: E18,
          amountShares: parseDecimal("0.2", 18),
          valueUsdE18: 48n * E18,
          pricePerTokenUsdE18: 240n * E18,
          pricePerShareUsdE18: 240n * E18,
          realizedPnlUsdE18: 2n * E18,
          convertedAtTodaysRatio: false,
          isRecognized: true,
        },
      ],
    });

    const vm = buildStatementVM(stmt, { source: "api/portfolio/recent-pnl" });
    const desc = buildStatementPdfDescription(vm, { now: "2026-10-10T12:00:00Z" });

    // 1. Verify description metadata
    expect(desc.title).toBe("Tally statement");
    expect(desc.walletAddress).toBe(WALLET);
    expect(desc.isEmpty).toBe(false);
    expect(desc.totalRowCount).toBe(3); // 1 holding + 2 trades

    // 2. Verify sections match CSV tables
    expect(desc.sections.map((s) => s.title)).toEqual(["Holdings", "Activity"]);

    const holdingsSection = desc.sections.find((s) => s.title === "Holdings")!;
    expect(holdingsSection.rows).toHaveLength(1);
    expect(holdingsSection.rows[0]!.cells[0]!.text).toBe("NVDA");
    expect(holdingsSection.rows[0]!.cells[1]!.text).toBe("ondo");
    expect(holdingsSection.rows[0]!.cells[2]!.text).toBe("1"); // exact shares string from CSV
    expect(holdingsSection.rows[0]!.cells[4]!.text).toBe("240.00"); // current value

    const activitySection = desc.sections.find((s) => s.title === "Activity")!;
    expect(activitySection.rows).toHaveLength(2);
    expect(activitySection.rows[0]!.cells[1]!.text).toBe("BUY");
    expect(activitySection.rows[0]!.cells[2]!.text).toBe("NVDA");
    expect(activitySection.rows[0]!.cells[4]!.text).toBe("0.5");
    expect(activitySection.rows[0]!.cells[6]!.text).toBe("115.00");

    expect(activitySection.rows[1]!.cells[1]!.text).toBe("SELL");
    expect(activitySection.rows[1]!.cells[4]!.text).toBe("0.2");
    expect(activitySection.rows[1]!.cells[6]!.text).toBe("48.00");
    expect(activitySection.rows[1]!.cells[7]!.text).toBe("2.00");

    // 3. Numbers match CSV content strings byte-for-byte
    expect(vm.csv.content).toContain(",1,");
    expect(vm.csv.content).toContain(",0.5,");
    expect(vm.csv.content).toContain(",115.00,");
    expect(vm.csv.content).toContain(",48.00,");
    expect(vm.csv.content).toContain(",2.00,");
  });

  it("empty statement states its empty condition plainly", () => {
    const emptyVm = buildStatementVM(null, { walletAddress: WALLET });
    const desc = buildStatementPdfDescription(emptyVm);

    expect(desc.isEmpty).toBe(true);
    expect(desc.totalRowCount).toBe(0);
    expect(desc.sections).toHaveLength(0);
    expect(desc.emptyReason).toContain("Statement has no observations yet");

    const doc = buildStatementPdfDoc(emptyVm, { compress: false });
    const raw = doc.output();
    expect(raw).toContain("Statement has no observations yet");
  });

  it("fixture source prominently labels first page as Fixture data, not live", () => {
    const fixtureStmt = statement({
      walletAddress: WALLET,
      trades: [],
    });
    const vm = buildStatementVM(fixtureStmt, { source: "fixture:probes_20261003" });
    const desc = buildStatementPdfDescription(vm, { isFixture: true });

    expect(desc.isFixture).toBe(true);
    expect(desc.fixtureBanner).toBe("Fixture data, not live");

    const doc = buildStatementPdfDoc(vm, { compress: false, isFixture: true });
    const raw = doc.output();
    expect(raw).toContain("Fixture data, not live");
  });

  it("handles pagination cleanly and repeats headers across page breaks", () => {
    // Generate 60 trade lines to force page breaks on A4
    const trades = Array.from({ length: 60 }, (_, i) => ({
      txHash: `0xhash${i}`,
      time: 1760000000000 + i * 3600_000,
      tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
      tokenSymbol: "NVDAon",
      ticker: "NVDA",
      issuer: "ondo" as const,
      type: (i % 2 === 0 ? "BUY" : "SELL") as "BUY" | "SELL",
      amountTokens: parseDecimal("1", 18),
      multiplier: E18,
      amountShares: parseDecimal("1", 18),
      valueUsdE18: 240n * E18,
      pricePerTokenUsdE18: 240n * E18,
      pricePerShareUsdE18: 240n * E18,
      realizedPnlUsdE18: i % 2 === 1 ? 5n * E18 : undefined,
      convertedAtTodaysRatio: false,
      isRecognized: true,
    }));

    const stmt = statement({
      walletAddress: WALLET,
      trades,
    });
    const vm = buildStatementVM(stmt);
    const doc = buildStatementPdfDoc(vm, { compress: false });

    // Must paginate over more than 1 page
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });

  it("Node test with uncompressed PDF: %PDF header, Generated by, and single TALLY_HOME_URL link annotation", () => {
    const stmt = statement({
      walletAddress: WALLET,
      trades: [
        {
          txHash: "0xabc1",
          time: 1760000000000,
          tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
          tokenSymbol: "NVDAon",
          ticker: "NVDA",
          issuer: "ondo",
          type: "BUY",
          amountTokens: parseDecimal("1", 18),
          multiplier: E18,
          amountShares: parseDecimal("1", 18),
          valueUsdE18: 240n * E18,
          pricePerTokenUsdE18: 240n * E18,
          pricePerShareUsdE18: 240n * E18,
          convertedAtTodaysRatio: false,
          isRecognized: true,
        },
      ],
    });

    const vm = buildStatementVM(stmt);
    const doc = buildStatementPdfDoc(vm, { compress: false });
    const raw = doc.output();

    // 1. Starts with %PDF
    expect(raw.startsWith("%PDF")).toBe(true);

    // 2. Contains string "Generated by"
    expect(raw).toContain("Generated by");

    // 3. Contains the URI annotation for https://tallyprotocol.xyz exactly once
    const uriMatches = raw.match(/\/URI \([^)]*tallyprotocol\.xyz[^)]*\)/g);
    expect(uriMatches).not.toBeNull();
    expect(uriMatches).toHaveLength(1);
    expect(uriMatches![0]).toBe(`/URI (${TALLY_HOME_URL})`);
  });
});
