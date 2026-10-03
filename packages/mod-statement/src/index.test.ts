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
  formatUsd,
  exportStatementCsv,
  assertBinanceCredentials,
  type StatementReceipt,
  type TokenRegistryInfo,
} from "./index";

const PROBE_FIXTURE_PATH = join(
  __dirname,
  "../../../spike/results/module_probes_20261003T130122Z.json",
);

function loadProbesFixture() {
  const content = readFileSync(PROBE_FIXTURE_PATH, "utf8");
  return JSON.parse(content) as Record<string, { data: unknown }>;
}

const TEST_REGISTRY: Record<string, TokenRegistryInfo> = {
  "0xa9ee28c80f960b889dfbd1902055218cba016f75": {
    ticker: "NVDA",
    issuer: "ondo",
    symbol: "NVDAon",
    decimals: 18,
    tokenToShareRatio: parseDecimal("1.0017152487959898", 18),
  },
  "0x02fca66c1d1afb4e2a7884261eb00f63598a7436": {
    ticker: "NVDA",
    issuer: "bstock",
    symbol: "NVDAB",
    decimals: 18,
    tokenToShareRatio: parseDecimal("1.000778223752807865", 18),
  },
};

describe("WO-03 Slice A: Portfolio and Statement pure logic", () => {
  const probes = loadProbesFixture();
  const BURNER_WALLET = "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930";

  it("parses the four Binance portfolio endpoints from probe fixtures", () => {
    // 1. X_recent_pnl
    const recentPnlRaw = probes["X_recent_pnl"]?.data;
    expect(recentPnlRaw).toBeDefined();
    const recentPnl = parseRecentPnl(recentPnlRaw);
    expect(recentPnl.pnlList.length).toBeGreaterThanOrEqual(2);
    const symbols = recentPnl.pnlList.map((p: { tokenSymbol: string }) => p.tokenSymbol);
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

  it("toShares: performs exact bigint conversion, sets today ratio flag, and fails gracefully when unavailable", () => {
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

    // 4. Finding 2: When neither observation nor today's ratio is provided, shares must be null with reason
    const res4 = toShares(tokens, undefined, undefined);
    expect(res4.amountShares).toBeNull();
    expect(res4.multiplier).toBeNull();
    expect(res4.convertedAtTodaysRatio).toBe(false);
    expect(res4.sharesUnavailableReason).toBeDefined();
  });

  it("statement: aggregates holdings across multiple issuers under the same ticker using registry lookup", () => {
    const recentPnl = parseRecentPnl(probes["X_recent_pnl"]?.data);
    const holdings = recentPnlToHoldings(recentPnl.pnlList, TEST_REGISTRY);
    const dexHistory = parseDexHistory(probes["X_dex_history"]?.data);
    const trades = dexHistoryToTrades(dexHistory.transactionList, TEST_REGISTRY);
    const pnlLines = recentPnlToPnlLines(recentPnl.pnlList, TEST_REGISTRY);

    const stmt = statement({
      walletAddress: BURNER_WALLET,
      holdings,
      trades,
      pnlLines,
      asOf: 1790948533000,
    });

    // NVDA ticker should group both NVDAon (Ondo) and NVDAB (bStock)
    const nvdaGroup = stmt.holdingsByTicker["NVDA"];
    expect(nvdaGroup).toBeDefined();
    expect(nvdaGroup!.issuers.length).toBe(2);

    const issuers = nvdaGroup!.issuers.map((i) => i.issuer);
    expect(issuers).toContain("ondo");
    expect(issuers).toContain("bstock");

    // Holdings converted with today's ratio from registry since no observation map passed
    expect(stmt.convertedAtTodaysRatioCount).toBeGreaterThan(0);

    // Total realized P&L is sum of lines in exact bigint
    expect(formatUsd(stmt.totalRealizedPnlUsdE18)).toBe("0.24");
    expect(stmt.trades.length).toBe(8);
  });

  it("handles unrecognized tokens by setting issuer null and excluding from share totals", () => {
    // 1. Unrecognized token address not in registry
    const item1 = {
      tokenContractAddress: "0x1111111111111111111111111111111111111111",
      tokenSymbol: "UNKNOWN",
      lastActiveTimestamp: "1790948533000",
      realizedPnlUsd: "0",
      realizedPnlPercent: "0",
      tokenBalanceUsd: "50",
      tokenBalanceAmount: "100",
    };

    const holdings1 = recentPnlToHoldings([item1], TEST_REGISTRY);
    expect(holdings1[0]!.issuer).toBeNull();
    expect(holdings1[0]!.isRecognized).toBe(false);
    expect(holdings1[0]!.unrecognizedReason).toBe("Not a recognised tokenized stock");
    expect(holdings1[0]!.balanceShares).toBeNull();

    // 2. Token in registry with unknown platform (issuer: null)
    const registryWithUnknownPlatform: Record<string, TokenRegistryInfo> = {
      "0x2222222222222222222222222222222222222222": {
        ticker: "RANDOM",
        issuer: null,
        symbol: "RNDM",
        decimals: 18,
      },
    };
    const item2 = {
      tokenContractAddress: "0x2222222222222222222222222222222222222222",
      tokenSymbol: "RNDM",
      lastActiveTimestamp: "1790948533000",
      realizedPnlUsd: "0",
      realizedPnlPercent: "0",
      tokenBalanceUsd: "50",
      tokenBalanceAmount: "100",
    };

    const holdings2 = recentPnlToHoldings([item2], registryWithUnknownPlatform);
    expect(holdings2[0]!.issuer).toBeNull();
    expect(holdings2[0]!.isRecognized).toBe(false);
    expect(holdings2[0]!.unrecognizedReason).toBe("Not a recognised tokenized stock");
    expect(holdings2[0]!.balanceShares).toBeNull();

    const stmt = statement({
      walletAddress: BURNER_WALLET,
      holdings: [...holdings1, ...holdings2],
    });

    expect(stmt.unrecognizedHoldings.length).toBe(2);
    expect(stmt.notes.some((n) => n.includes("not recognized as tokenized stocks"))).toBe(true);
  });

  it("statement: flags > 1% disagreement between API figure and receipts (differsFromApi)", () => {
    const pnlLines = [
      {
        tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
        tokenSymbol: "NVDAon",
        ticker: "NVDA",
        issuer: "ondo" as const,
        isRecognized: true,
        realizedPnlUsdE18: 10n * E18, // API says $10.00
        buyVolumeUsdE18: 100n * E18,
        sellVolumeUsdE18: 110n * E18,
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
        usdSpentOrReceivedE18: 100n * E18,
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
        usdSpentOrReceivedE18: 108n * E18, // realized PnL = $8.00
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
    expect(formatUsd(stmt.totalRealizedPnlUsdE18)).toBe("8.00");
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
        usdSpentOrReceivedE18: parseDecimal("115.0", 18),
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
        usdSpentOrReceivedE18: parseDecimal("115.5", 18),
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
      pricesByTickerE18: { NVDA: 240n * E18 },
    });

    expect(stmt.source).toBe("receipts");
    expect(stmt.notes).toContain(
      "Generated from on-chain receipts only (Binance API unavailable).",
    );
    expect(stmt.holdings.length).toBe(2);
    expect(stmt.holdingsByTicker["NVDA"]).toBeDefined();
    expect(formatUnits(stmt.holdingsByTicker["NVDA"]!.totalShares, 18)).toBe("1");
    expect(formatUsd(stmt.totalCostBasisUsdE18)).toBe("230.50");
    expect(formatUsd(stmt.totalValueUsdE18)).toBe("240.00");
    expect(formatUsd(stmt.totalUnrealizedPnlUsdE18)).toBe("9.50");
  });

  it("exports valid RFC 4180 CSV with summary, holdings, and activity", () => {
    const recentPnl = parseRecentPnl(probes["X_recent_pnl"]?.data);
    const holdings = recentPnlToHoldings(recentPnl.pnlList, TEST_REGISTRY);
    const dexHistory = parseDexHistory(probes["X_dex_history"]?.data);
    const trades = dexHistoryToTrades(dexHistory.transactionList, TEST_REGISTRY);

    const stmt = statement({
      walletAddress: BURNER_WALLET,
      holdings,
      trades,
      asOf: 1790948533000,
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
    expect(stmt.totalValueUsdE18).toBe(0n);
    expect(stmt.totalRealizedPnlUsdE18).toBe(0n);
    expect(stmt.differsFromApi).toBe(false);
  });

  it("assertBinanceCredentials: throws when live credentials missing and not in fixture mode", () => {
    // 1. In fixture mode: should not throw even with missing credentials
    expect(() =>
      assertBinanceCredentials({
        TALLY_FIXTURES: "1",
      }),
    ).not.toThrow();

    // 2. In live mode: throws when keys are missing
    expect(() =>
      assertBinanceCredentials({
        TALLY_FIXTURES: "0",
        BINANCE_W3_API_KEY: undefined,
        BINANCE_W3_API_SECRET: undefined,
      }),
    ).toThrow("Binance API credentials missing");

    expect(() =>
      assertBinanceCredentials({
        TALLY_FIXTURES: "",
        BINANCE_W3_API_KEY: "key_only",
      }),
    ).toThrow("Binance API credentials missing");

    expect(() =>
      assertBinanceCredentials({
        TALLY_FIXTURES: "0",
        BINANCE_W3_API_SECRET: "secret_only",
      }),
    ).toThrow("Binance API credentials missing");

    // 3. In live mode with both keys present: should not throw
    expect(() =>
      assertBinanceCredentials({
        TALLY_FIXTURES: "0",
        BINANCE_W3_API_KEY: "my_key",
        BINANCE_W3_API_SECRET: "my_secret",
      }),
    ).not.toThrow();
  });
});
