import { describe, expect, it } from "vitest";
import {
  E18,
  parseDecimal,
  statement,
  type StatementReceipt,
  type Holding,
} from "@tally/mod-statement";
import { buildPortfolioVM, buildStatementVM, loadPortfolio, loadStatement } from "./view-model";

const WALLET = "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930";

describe("WO-03 Slice B: View-model tests", () => {
  it("empty wallet returns empty view model with clean reason and zero values", async () => {
    const portfolioVM = buildPortfolioVM(null, { walletAddress: WALLET });
    expect(portfolioVM.state).toBe("empty");
    expect(portfolioVM.holdings).toEqual([]);
    expect(portfolioVM.totalValueUsd).toBe("0.00");
    expect(portfolioVM.totalRealizedPnlUsd).toBe("0.00");
    expect(portfolioVM.reason).toBe("No holdings in this wallet.");

    const statementVM = await loadStatement();
    expect(statementVM.state).toBe("empty");
    expect(statementVM.lines).toEqual([]);
    expect(statementVM.reason).toBe("Statement has no observations yet.");
    expect(statementVM.error).toBeNull();
    expect(statementVM.asOf).toBeNull();
  });

  it("one issuer wallet produces headline holding and single issuer row with rowActionsSlot metadata", () => {
    const ondoHolding: Holding = {
      tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
      tokenSymbol: "NVDAon",
      ticker: "NVDA",
      issuer: "ondo",
      isRecognized: true,
      balanceTokens: parseDecimal("0.5", 18),
      multiplier: E18,
      balanceShares: parseDecimal("0.5", 18),
      convertedAtTodaysRatio: false,
      tokenBalanceUsdE18: 120n * E18,
      costBasisUsdE18: 115n * E18,
      avgCostPerShareUsdE18: 230n * E18,
      pricePerShareUsdE18: 240n * E18,
      unrealizedPnlUsdE18: 5n * E18,
      source: "api/portfolio/recent-pnl",
    };

    const stmt = statement({
      walletAddress: WALLET,
      holdings: [ondoHolding],
    });

    const vm = buildPortfolioVM(stmt);
    expect(vm.state).toBe("ready");
    expect(vm.holdings.length).toBe(1);

    const holding = vm.holdings[0]!;
    expect(holding.ticker).toBe("NVDA");
    expect(holding.totalShares).toBe("0.5");
    expect(holding.totalValueUsd).toBe("120.00");
    expect(holding.issuers.length).toBe(1);
    expect(holding.issuers[0]!.issuer).toBe("ondo");
    expect(holding.issuers[0]!.balanceShares).toBe("0.5");

    // rowActionsSlot carries token, issuer, balance for WO-07 and WO-10
    expect(holding.rowActionsSlot).toEqual({
      token: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
      issuer: "ondo",
      balanceTokens: "0.5",
      balanceShares: "0.5",
      ticker: "NVDA",
    });
  });

  it("two issuers of the same ticker are aggregated under one headline with issuer breakdowns", () => {
    const ondoHolding: Holding = {
      tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
      tokenSymbol: "NVDAon",
      ticker: "NVDA",
      issuer: "ondo",
      isRecognized: true,
      balanceTokens: parseDecimal("0.75", 18),
      multiplier: E18,
      balanceShares: parseDecimal("0.75", 18),
      convertedAtTodaysRatio: false,
      tokenBalanceUsdE18: 180n * E18,
      costBasisUsdE18: parseDecimal("172.5", 18),
      avgCostPerShareUsdE18: 230n * E18,
      pricePerShareUsdE18: 240n * E18,
      unrealizedPnlUsdE18: parseDecimal("7.5", 18),
      source: "api/portfolio/recent-pnl",
    };

    const bstockHolding: Holding = {
      tokenContractAddress: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
      tokenSymbol: "NVDAB",
      ticker: "NVDA",
      issuer: "bstock",
      isRecognized: true,
      balanceTokens: parseDecimal("0.25", 18),
      multiplier: E18,
      balanceShares: parseDecimal("0.25", 18),
      convertedAtTodaysRatio: false,
      tokenBalanceUsdE18: 60n * E18,
      costBasisUsdE18: parseDecimal("57.5", 18),
      avgCostPerShareUsdE18: 230n * E18,
      pricePerShareUsdE18: 240n * E18,
      unrealizedPnlUsdE18: parseDecimal("2.5", 18),
      source: "api/portfolio/recent-pnl",
    };

    const stmt = statement({
      walletAddress: WALLET,
      holdings: [ondoHolding, bstockHolding],
    });

    const vm = buildPortfolioVM(stmt);
    expect(vm.state).toBe("ready");
    expect(vm.holdings.length).toBe(1);

    const headline = vm.holdings[0]!;
    expect(headline.ticker).toBe("NVDA");
    expect(headline.totalShares).toBe("1"); // 0.75 + 0.25 = 1.00 shares
    expect(headline.totalValueUsd).toBe("240.00");
    expect(headline.issuers.length).toBe(2);

    const issuerNames = headline.issuers.map((i) => i.issuer);
    expect(issuerNames).toContain("ondo");
    expect(issuerNames).toContain("bstock");
  });

  it("API down produces degraded statement from receipts without errors", () => {
    const receipts: StatementReceipt[] = [
      {
        id: "r-down-1",
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
    ];

    const stmt = statement({
      walletAddress: WALLET,
      apiFailed: true,
      apiError: "50000 Internal server error",
      receipts,
      pricesByTickerE18: { NVDA: 240n * E18 },
    });

    const statementVM = buildStatementVM(stmt);
    expect(statementVM.state).toBe("degraded");
    expect(statementVM.source).toBe("receipts");
    expect(statementVM.notes).toContain(
      "Generated from on-chain receipts only (Binance API unavailable).",
    );
    expect(statementVM.csv.content).toContain("# Tally Portfolio Statement");

    const portfolioVM = buildPortfolioVM(stmt);
    expect(portfolioVM.state).toBe("ready");
    expect(portfolioVM.holdings.length).toBe(1);
    expect(portfolioVM.holdings[0]!.totalShares).toBe("0.5");
  });

  it("Flag off: Portfolio shows holdings only (no statement tab), no errors", async () => {
    const ondoHolding: Holding = {
      tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
      tokenSymbol: "NVDAon",
      ticker: "NVDA",
      issuer: "ondo",
      isRecognized: true,
      balanceTokens: parseDecimal("1", 18),
      multiplier: E18,
      balanceShares: parseDecimal("1", 18),
      convertedAtTodaysRatio: false,
      tokenBalanceUsdE18: 240n * E18,
      costBasisUsdE18: 230n * E18,
      avgCostPerShareUsdE18: 230n * E18,
      pricePerShareUsdE18: 240n * E18,
      unrealizedPnlUsdE18: 10n * E18,
      source: "api/portfolio/recent-pnl",
    };

    const stmt = statement({
      walletAddress: WALLET,
      holdings: [ondoHolding],
    });

    // 1. With statement flag turned OFF
    const vmFlagOff = buildPortfolioVM(stmt, {
      flags: { statement: false, receipts: false },
    });
    expect(vmFlagOff.availableTabs).toEqual(["holdings"]);
    expect(vmFlagOff.availableTabs).not.toContain("statement");
    expect(vmFlagOff.availableTabs).not.toContain("activity");
    expect(vmFlagOff.holdings.length).toBe(1);
    expect(vmFlagOff.error).toBeNull();

    // 2. With statement flag turned ON
    const vmFlagOn = buildPortfolioVM(stmt, {
      flags: { statement: true, receipts: false },
    });
    expect(vmFlagOn.availableTabs).toContain("statement");
    expect(vmFlagOn.availableTabs).toContain("holdings");

    // 3. With receipts flag turned ON as well
    const vmBothFlags = buildPortfolioVM(stmt, {
      flags: { statement: true, receipts: true },
    });
    expect(vmBothFlags.availableTabs).toEqual(["holdings", "activity", "statement"]);
  });

  it("loadPortfolio and loadStatement read snapshots from store and reflect staleness", async () => {
    const { openStore } = await import("@tally/modkit");
    const store = openStore(":memory:");
    try {
      const ondoHolding: Holding = {
        tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
        tokenSymbol: "NVDAon",
        ticker: "NVDA",
        issuer: "ondo",
        isRecognized: true,
        balanceTokens: parseDecimal("1", 18),
        multiplier: E18,
        balanceShares: parseDecimal("1", 18),
        convertedAtTodaysRatio: false,
        tokenBalanceUsdE18: 240n * E18,
        costBasisUsdE18: 230n * E18,
        avgCostPerShareUsdE18: 230n * E18,
        pricePerShareUsdE18: 240n * E18,
        unrealizedPnlUsdE18: 10n * E18,
        source: "api/portfolio/recent-pnl",
      };

      const stmt = statement({
        walletAddress: WALLET,
        holdings: [ondoHolding],
        asOf: Date.now() - 400_000, // 400s old -> stale for maxAgeMs 300_000
      });

      store.put({
        kind: "statement",
        key: WALLET.toLowerCase(),
        data: stmt,
        source: "worker-statement",
        observedAt: Date.now() - 400_000,
      });

      const portfolioVM = await loadPortfolio({ walletAddress: WALLET, store });
      expect(portfolioVM.state).toBe("ready");
      expect(portfolioVM.holdings.length).toBe(1);
      expect(portfolioVM.source).toBe("worker-statement");
      expect(portfolioVM.stale).toBe(true);

      const statementVM = await loadStatement({ walletAddress: WALLET, store });
      expect(statementVM.state).toBe("ready");
      expect(statementVM.source).toBe("worker-statement");
      expect(statementVM.stale).toBe(true);
    } finally {
      store.close();
    }
  });
});

describe("additive view-model fields (WO-12 decisions 2026-10-06)", () => {
  const base = (over: Partial<Holding>): Holding => ({
    tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
    tokenSymbol: "NVDAon",
    ticker: "NVDA",
    issuer: "ondo",
    isRecognized: true,
    balanceTokens: parseDecimal("0.5", 18),
    multiplier: E18,
    balanceShares: parseDecimal("0.5", 18),
    convertedAtTodaysRatio: false,
    tokenBalanceUsdE18: 120n * E18,
    costBasisUsdE18: 115n * E18,
    avgCostPerShareUsdE18: 230n * E18,
    pricePerShareUsdE18: 240n * E18,
    unrealizedPnlUsdE18: 5n * E18,
    source: "api/portfolio/recent-pnl",
    ...over,
  });

  it("never collected (no snapshot) is distinct from a collected wallet that holds nothing", async () => {
    const never = buildPortfolioVM(null, { walletAddress: WALLET });
    expect(never.state).toBe("empty");
    expect(never.emptyKind).toBe("never_collected");
    expect(never.reason).toBe("No holdings in this wallet."); // unchanged: the fields are additive
    const noHoldings = buildPortfolioVM(statement({ walletAddress: WALLET, holdings: [] }));
    expect(noHoldings.emptyKind).toBe("no_holdings");
    expect(buildStatementVM(null).emptyKind).toBe("never_collected");
    expect(buildStatementVM(statement({ walletAddress: WALLET })).emptyKind).toBe("no_holdings");
    // A ready view model has no emptyKind.
    const ready = buildPortfolioVM(statement({ walletAddress: WALLET, holdings: [base({})] }));
    expect(ready.state).toBe("ready");
    expect(ready.emptyKind).toBeUndefined();
  });

  it("realizedKnown is true only when a sale carries a realized figure", () => {
    const trade = (realized?: bigint) => ({
      txHash: `0x${"11".repeat(32)}`,
      time: 1_000,
      type: "SELL" as const,
      tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
      tokenSymbol: "NVDAon",
      ticker: "NVDA",
      issuer: "ondo" as const,
      isRecognized: true,
      amountTokens: parseDecimal("0.1", 18),
      multiplier: E18,
      amountShares: parseDecimal("0.1", 18),
      convertedAtTodaysRatio: false,
      pricePerTokenUsdE18: 240n * E18,
      pricePerShareUsdE18: 240n * E18,
      valueUsdE18: 24n * E18,
      ...(realized === undefined ? {} : { realizedPnlUsdE18: realized }),
    });
    const without = statement({ walletAddress: WALLET, holdings: [base({})], trades: [trade()] });
    expect(buildPortfolioVM(without).realizedKnown).toBe(false);
    expect(buildStatementVM(without).realizedKnown).toBe(false);
    const withRealized = statement({
      walletAddress: WALLET,
      holdings: [base({})],
      trades: [trade(2n * E18)],
    });
    expect(buildPortfolioVM(withRealized).realizedKnown).toBe(true);
    expect(buildStatementVM(withRealized).realizedKnown).toBe(true);
  });

  it("the reason shares are unknown passes through on a holding row and a statement line", () => {
    const reason = "No multiplier observation for this token";
    const stmt = statement({
      walletAddress: WALLET,
      holdings: [base({ multiplier: null, balanceShares: null, sharesUnavailableReason: reason })],
      trades: [
        {
          txHash: `0x${"22".repeat(32)}`,
          time: 1_000,
          type: "BUY",
          tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
          tokenSymbol: "NVDAon",
          ticker: "NVDA",
          issuer: "ondo",
          isRecognized: true,
          amountTokens: parseDecimal("0.1", 18),
          multiplier: null,
          amountShares: null,
          sharesUnavailableReason: reason,
          convertedAtTodaysRatio: false,
          pricePerTokenUsdE18: 240n * E18,
          pricePerShareUsdE18: null,
          valueUsdE18: 24n * E18,
        },
      ],
    });
    const row = buildPortfolioVM(stmt).holdings[0]!.issuers[0]!;
    expect(row.balanceShares).toBe("unavailable");
    expect(row.sharesUnavailableReason).toBe(reason);
    const line = buildStatementVM(stmt).lines[0]!;
    expect(line.amountShares).toBe("unavailable");
    expect(line.sharesUnavailableReason).toBe(reason);
  });

  it("known shares carry no reason key", () => {
    const row = buildPortfolioVM(statement({ walletAddress: WALLET, holdings: [base({})] }))
      .holdings[0]!.issuers[0]!;
    expect("sharesUnavailableReason" in row).toBe(false);
  });
});
