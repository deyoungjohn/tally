import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { E18, parseDecimal, formatUnits } from "@tally/core";
import {
  parseRecentPnl,
  parseTokenLatestPnl,
  parseDexHistory,
  parsePortfolioOverview,
  recentPnlToHoldings,
  dexHistoryToTrades,
  recentPnlToPnlLines,
  toShares,
  statement,
  exportStatementCsv,
  type StatementReceipt,
} from "./index";

const PROBE_FIXTURE_PATH = join(
  __dirname,
  "../../../spike/results/module_probes_20261003T130122Z.json",
);

function loadProbesFixture() {
  const content = readFileSync(PROBE_FIXTURE_PATH, "utf8");
  return JSON.parse(content) as Record<string, { data: unknown }>;
}

describe("WO-03 Slice A: Portfolio and Statement pure logic", () => {
  const probes = loadProbesFixture();
  const BURNER_WALLET = "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930";

  it("parses the four Binance portfolio endpoints from probe fixtures", () => {
    // 1. X_recent_pnl
    const recentPnlRaw = probes["X_recent_pnl"]?.data;
    expect(recentPnlRaw).toBeDefined();
    const recentPnl = parseRecentPnl(recentPnlRaw);
    expect(recentPnl.pnlList.length).toBeGreaterThanOrEqual(2);
    const symbols = recentPnl.pnlList.map((p) => p.tokenSymbol);
    expect(symbols).toContain("NVDAon");
    expect(symbols).toContain("NVDAB");

    // 2. X_token_pnl
    const tokenPnlRaw = probes["X_token_pnl"]?.data;
    expect(tokenPnlRaw).toBeDefined();
    const tokenPnl = parseTokenLatestPnl(tokenPnlRaw);
    expect(Number(tokenPnl.realizedPnlUsd)).toBeCloseTo(0.13059, 4);
    expect(tokenPnl.isPnlSupported).toBe(true);

    // 3. X_dex_history
    const dexHistoryRaw = probes["X_dex_history"]?.data;
    expect(dexHistoryRaw).toBeDefined();
    const dexHistory = parseDexHistory(dexHistoryRaw);
    expect(dexHistory.transactionList.length).toBe(8);
    expect(dexHistory.transactionList[0]?.txHash).toBe(
      "0x92b8e340cd8cfb30521bab19be649e4a66f59b454fc243a28304a1a6a26bb82d",
    );

    // 4. X_portfolio_overview_tf
    const overviewRaw = probes["X_portfolio_overview_tf"]?.data;
    expect(overviewRaw).toBeDefined();
    const overview = parsePortfolioOverview(overviewRaw);
    expect(overview.realizedPnlUsd).toBe("0");
    expect(overview.dailyPnl).toBeDefined();
  });

  it("toShares: performs exact bigint conversion and sets today's ratio flag", () => {
    const tokens = parseDecimal("2.5", 18); // 2.5 * 10^18 tokens

    // 1. When multiplier observation exists: uses observation and convertedAtTodaysRatio is false
    const ondoObservation = {
      multiplier: 10n * E18, // 10 shares per token (e.g. Ondo NFLX)
      observedAt: 1790948533000,
    };
    const res1 = toShares(tokens, ondoObservation);
    expect(res1.amountShares).toBe(25n * E18); // 2.5 * 10 = 25 shares
    expect(res1.convertedAtTodaysRatio).toBe(false);
    expect(res1.multiplier).toBe(10n * E18);

    // 2. When multiplier observation is a raw bigint
    const res2 = toShares(tokens, 2n * E18);
    expect(res2.amountShares).toBe(5n * E18);
    expect(res2.convertedAtTodaysRatio).toBe(false);

    // 3. When multiplier observation is null: falls back to today's ratio and convertedAtTodaysRatio is true
    const todaysRatio = 4n * E18;
    const res3 = toShares(tokens, null, todaysRatio);
    expect(res3.amountShares).toBe(10n * E18); // 2.5 * 4 = 10 shares
    expect(res3.convertedAtTodaysRatio).toBe(true);
    expect(res3.multiplier).toBe(todaysRatio);

    // 4. When multiplier observation is undefined: falls back to 1e18 default ratio
    const res4 = toShares(tokens, undefined);
    expect(res4.amountShares).toBe(tokens);
    expect(res4.convertedAtTodaysRatio).toBe(true);
    expect(res4.multiplier).toBe(E18);
  });

  it("statement: aggregates holdings across multiple issuers under the same ticker", () => {
    const recentPnl = parseRecentPnl(probes["X_recent_pnl"]?.data);
    const holdings = recentPnlToHoldings(recentPnl.pnlList);
    const dexHistory = parseDexHistory(probes["X_dex_history"]?.data);
    const trades = dexHistoryToTrades(dexHistory.transactionList);
    const pnlLines = recentPnlToPnlLines(recentPnl.pnlList);

    const stmt = statement({
      walletAddress: BURNER_WALLET,
      holdings,
      trades,
      pnlLines,
    });

    // NVDA ticker should group both NVDAon (Ondo) and NVDAB (bStock)
    const nvdaGroup = stmt.holdingsByTicker["NVDA"];
    expect(nvdaGroup).toBeDefined();
    expect(nvdaGroup!.issuers.length).toBe(2);

    const issuers = nvdaGroup!.issuers.map((i) => i.issuer);
    expect(issuers).toContain("ondo");
    expect(issuers).toContain("bstock");

    // Total realized P&L is sum of lines
    expect(stmt.totalRealizedPnlUsd).toBeCloseTo(0.108578 + 0.130595, 4);
    expect(stmt.trades.length).toBe(8);
  });

  it("statement: flags > 1% disagreement between API figure and receipts (differsFromApi)", () => {
    const pnlLines = [
      {
        tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
        tokenSymbol: "NVDAon",
        ticker: "NVDA",
        issuer: "ondo" as const,
        realizedPnlUsd: 10.0, // API says $10.00
        realizedPnlPercent: 0.1,
        buyVolumeUsd: 100,
        sellVolumeUsd: 110,
        buyTxCount: 1,
        sellTxCount: 1,
        lastActiveTimestamp: 1790948533000,
      },
    ];

    // Receipts say $8.00 (a 20% disagreement > 1%)
    const receipts: StatementReceipt[] = [
      {
        id: "r-buy-1",
        tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
        tokenSymbol: "NVDAon",
        ticker: "NVDA",
        issuer: "ondo",
        side: "BUY",
        tokens: 1n * E18,
        shares: 1n * E18,
        multiplier: 1n * E18,
        usdSpentOrReceived: 100,
        executedAt: 1000,
        status: "RECONCILED",
      },
      {
        id: "r-sell-1",
        tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
        tokenSymbol: "NVDAon",
        ticker: "NVDA",
        issuer: "ondo",
        side: "SELL",
        tokens: 1n * E18,
        shares: 1n * E18,
        multiplier: 1n * E18,
        usdSpentOrReceived: 108, // realized PnL = $8.00
        executedAt: 2000,
        status: "RECONCILED",
      },
    ];

    const stmt = statement({
      walletAddress: BURNER_WALLET,
      pnlLines,
      receipts,
    });

    expect(stmt.differsFromApi).toBe(true);
    expect(stmt.differsFromApiNote).toBeDefined();
    expect(stmt.differsFromApiNote).toContain("differs from Binance API figure");
    expect(stmt.notes.some((n) => n.includes("differs from Binance API figure"))).toBe(true);
    // Uses share-true receipts figure when disagreeing
    expect(stmt.totalRealizedPnlUsd).toBe(8.0);
  });

  it("API failure (mocked 50000) generates statement from receipts only with visible note", () => {
    // Receipts in wallet
    const receipts: StatementReceipt[] = [
      {
        id: "r-1",
        tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
        tokenSymbol: "NVDAon",
        ticker: "NVDA",
        issuer: "ondo",
        side: "BUY",
        tokens: parseDecimal("0.5", 18),
        shares: parseDecimal("0.5", 18),
        multiplier: E18,
        usdSpentOrReceived: 115.0,
        executedAt: 1790935427000,
        status: "RECONCILED",
      },
      {
        id: "r-2",
        tokenContractAddress: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
        tokenSymbol: "NVDAB",
        ticker: "NVDA",
        issuer: "bstock",
        side: "BUY",
        tokens: parseDecimal("0.5", 18),
        shares: parseDecimal("0.5", 18),
        multiplier: E18,
        usdSpentOrReceived: 115.5,
        executedAt: 1790935428000,
        status: "RECONCILED",
      },
    ];

    // Simulated 50000 API failure: apiFailed: true, no holdings from API
    const stmt = statement({
      walletAddress: BURNER_WALLET,
      apiFailed: true,
      apiError: "50000 Internal server error",
      holdings: [],
      trades: [],
      receipts,
      pricesByTicker: { NVDA: 240.0 },
    });

    expect(stmt.source).toBe("receipts");
    expect(stmt.notes).toContain(
      "Generated from on-chain receipts only (Binance API unavailable).",
    );
    expect(stmt.holdings.length).toBe(2);
    expect(stmt.holdingsByTicker["NVDA"]).toBeDefined();
    expect(formatUnits(stmt.holdingsByTicker["NVDA"]!.totalShares, 18)).toBe("1");
    expect(stmt.totalCostBasisUsd).toBe(230.5);
    expect(stmt.totalValueUsd).toBe(240.0);
    expect(stmt.totalUnrealizedPnlUsd).toBe(9.5);
  });

  it("exports valid RFC 4180 CSV with summary, holdings, and activity", () => {
    const recentPnl = parseRecentPnl(probes["X_recent_pnl"]?.data);
    const holdings = recentPnlToHoldings(recentPnl.pnlList);
    const dexHistory = parseDexHistory(probes["X_dex_history"]?.data);
    const trades = dexHistoryToTrades(dexHistory.transactionList);

    const stmt = statement({
      walletAddress: BURNER_WALLET,
      holdings,
      trades,
    });

    const csv = exportStatementCsv(stmt);
    expect(csv).toContain("# Tally Portfolio Statement");
    expect(csv).toContain(BURNER_WALLET);
    expect(csv).toContain("# Holdings");
    expect(csv).toContain("# Activity / Trades");
    expect(csv).toContain("NVDAon");
    expect(csv).toContain("NVDAB");
    expect(csv).toContain("0x92b8e340cd8cfb30521bab19be649e4a66f59b454fc243a28304a1a6a26bb82d");
  });

  it("handles empty wallet cleanly without errors", () => {
    const stmt = statement({
      walletAddress: "0x0000000000000000000000000000000000000000",
      holdings: [],
      trades: [],
      pnlLines: [],
    });

    expect(stmt.holdings.length).toBe(0);
    expect(stmt.trades.length).toBe(0);
    expect(stmt.totalValueUsd).toBe(0);
    expect(stmt.totalRealizedPnlUsd).toBe(0);
    expect(stmt.differsFromApi).toBe(false);
  });

  it("handles single issuer portfolio without discrepancy", () => {
    const receipts: StatementReceipt[] = [
      {
        id: "r-single-1",
        tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
        tokenSymbol: "NVDAon",
        ticker: "NVDA",
        issuer: "ondo",
        side: "BUY",
        tokens: 1n * E18,
        shares: 1n * E18,
        multiplier: 1n * E18,
        usdSpentOrReceived: 100,
        executedAt: 1000,
        status: "RECONCILED",
      },
      {
        id: "r-single-2",
        tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
        tokenSymbol: "NVDAon",
        ticker: "NVDA",
        issuer: "ondo",
        side: "SELL",
        tokens: 1n * E18,
        shares: 1n * E18,
        multiplier: 1n * E18,
        usdSpentOrReceived: 105, // realized $5.00
        executedAt: 2000,
        status: "RECONCILED",
      },
    ];

    const pnlLines = [
      {
        tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
        tokenSymbol: "NVDAon",
        ticker: "NVDA",
        issuer: "ondo" as const,
        realizedPnlUsd: 5.0, // API agrees exactly
        realizedPnlPercent: 0.05,
        buyVolumeUsd: 100,
        sellVolumeUsd: 105,
        buyTxCount: 1,
        sellTxCount: 1,
        lastActiveTimestamp: 2000,
      },
    ];

    const stmt = statement({
      walletAddress: BURNER_WALLET,
      pnlLines,
      receipts,
    });

    expect(stmt.differsFromApi).toBe(false);
    expect(stmt.totalRealizedPnlUsd).toBe(5.0);
  });

  it("escapes CSV values with commas, quotes, and newlines properly", () => {
    const stmt = statement({
      walletAddress: "0x1234,special",
      holdings: [],
      trades: [],
      pnlLines: [],
    });
    stmt.notes = ['Note with "quotes", commas, and\nnewlines'];

    const csv = exportStatementCsv(stmt);
    expect(csv).toContain('"0x1234,special"');
    expect(csv).toContain('"Note with ""quotes"", commas, and\nnewlines"');
  });
});
