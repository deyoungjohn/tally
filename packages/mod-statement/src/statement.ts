import { E18, mulDiv, formatUnits } from "@tally/core";
import type {
  Statement,
  Holding,
  Trade,
  PnlLine,
  StatementReceipt,
  TickerHoldingsGroup,
} from "./types";

export interface StatementOptions {
  walletAddress: string;
  holdings?: Holding[];
  trades?: Trade[];
  pnlLines?: PnlLine[];
  receipts?: StatementReceipt[];
  pricesByTickerE18?: Record<string, bigint>;
  asOf?: number | null;
  asOfReason?: string;
  apiFailed?: boolean;
  apiError?: string;
}

/** Ensures required Binance Web3 API credentials exist unless running in fixture mode */
export function assertBinanceCredentials(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.TALLY_FIXTURES === "1") return;
  if (!env.BINANCE_W3_API_KEY || !env.BINANCE_W3_API_SECRET) {
    throw new Error("Binance API credentials missing");
  }
}

/** Formats a 1e18 fixed point USD bigint to standard 2-decimal string with round-to-nearest-cent */
export function formatUsd(amountE18: bigint): string {
  const neg = amountE18 < 0n;
  const abs = neg ? -amountE18 : amountE18;
  const whole = abs / E18;
  const cents = ((abs % E18) + 5_000_000_000_000_000n) / 10_000_000_000_000_000n;
  if (cents >= 100n) {
    return `${neg ? "-" : ""}${whole + 1n}.00`;
  }
  return `${neg ? "-" : ""}${whole}.${cents.toString().padStart(2, "0")}`;
}

/** Calculate realized P&L from a list of receipts using exact bigint average cost matching */
function calculateReceiptsRealizedPnl(receipts: StatementReceipt[]): bigint {
  const buyPoolByTicker: Record<string, { totalShares: bigint; totalCostUsdE18: bigint }> = {};
  let totalRealizedPnlE18 = 0n;

  // Sort receipts chronologically
  const sorted = [...receipts].sort((a, b) => a.executedAt - b.executedAt);

  for (const r of sorted) {
    if (r.status === "FAILED") continue;
    const ticker = r.ticker.toUpperCase();
    if (!buyPoolByTicker[ticker]) {
      buyPoolByTicker[ticker] = { totalShares: 0n, totalCostUsdE18: 0n };
    }

    const pool = buyPoolByTicker[ticker]!;

    if (r.side === "BUY") {
      pool.totalShares += r.shares;
      pool.totalCostUsdE18 += r.usdSpentOrReceivedE18;
    } else if (r.side === "SELL") {
      const avgCostPerShareE18 =
        pool.totalShares > 0n ? mulDiv(pool.totalCostUsdE18, E18, pool.totalShares) : 0n;
      const costOfSoldSharesE18 = mulDiv(r.shares, avgCostPerShareE18, E18);
      const proceedsE18 = r.usdSpentOrReceivedE18;
      const pnlE18 = proceedsE18 - costOfSoldSharesE18;
      totalRealizedPnlE18 += pnlE18;

      // Deduct from pool
      pool.totalShares = pool.totalShares > r.shares ? pool.totalShares - r.shares : 0n;
      pool.totalCostUsdE18 =
        pool.totalCostUsdE18 > costOfSoldSharesE18
          ? pool.totalCostUsdE18 - costOfSoldSharesE18
          : 0n;
    }
  }

  return totalRealizedPnlE18;
}

/** Synthesize holdings and trades from receipts when API is unavailable */
function synthesizeFromReceipts(
  receipts: StatementReceipt[],
  pricesByTickerE18: Record<string, bigint> = {},
): { holdings: Holding[]; trades: Trade[] } {
  const tokenMap: Record<
    string,
    {
      tokenContractAddress: string;
      tokenSymbol: string;
      ticker: string;
      issuer: Holding["issuer"];
      balanceTokens: bigint;
      balanceShares: bigint;
      multiplier: bigint;
      costBasisUsdE18: bigint;
    }
  > = {};

  const sorted = [...receipts].sort((a, b) => a.executedAt - b.executedAt);
  const trades: Trade[] = [];

  for (const r of sorted) {
    if (r.status === "FAILED") continue;
    const key = r.tokenContractAddress.toLowerCase();
    if (!tokenMap[key]) {
      tokenMap[key] = {
        tokenContractAddress: key,
        tokenSymbol: r.tokenSymbol,
        ticker: r.ticker.toUpperCase(),
        issuer: r.issuer,
        balanceTokens: 0n,
        balanceShares: 0n,
        multiplier: r.multiplier,
        costBasisUsdE18: 0n,
      };
    }

    const t = tokenMap[key]!;
    t.multiplier = r.multiplier;

    const pricePerShareUsdE18 = r.shares > 0n ? mulDiv(r.usdSpentOrReceivedE18, E18, r.shares) : 0n;
    const pricePerTokenUsdE18 = r.tokens > 0n ? mulDiv(r.usdSpentOrReceivedE18, E18, r.tokens) : 0n;

    trades.push({
      txHash: r.txHash ?? `receipt-${r.id}`,
      time: r.executedAt,
      type: r.side,
      tokenContractAddress: key,
      tokenSymbol: r.tokenSymbol,
      ticker: r.ticker.toUpperCase(),
      issuer: r.issuer,
      isRecognized: true,
      amountTokens: r.tokens,
      multiplier: r.multiplier,
      amountShares: r.shares,
      convertedAtTodaysRatio: false,
      pricePerTokenUsdE18,
      pricePerShareUsdE18,
      valueUsdE18: r.usdSpentOrReceivedE18,
    });

    if (r.side === "BUY") {
      t.balanceTokens += r.tokens;
      t.balanceShares += r.shares;
      t.costBasisUsdE18 += r.usdSpentOrReceivedE18;
    } else if (r.side === "SELL") {
      const avgCostE18 =
        t.balanceShares > 0n ? mulDiv(t.costBasisUsdE18, E18, t.balanceShares) : 0n;
      const soldCostE18 = mulDiv(r.shares, avgCostE18, E18);
      t.balanceTokens = t.balanceTokens > r.tokens ? t.balanceTokens - r.tokens : 0n;
      t.balanceShares = t.balanceShares > r.shares ? t.balanceShares - r.shares : 0n;
      t.costBasisUsdE18 = t.costBasisUsdE18 > soldCostE18 ? t.costBasisUsdE18 - soldCostE18 : 0n;
    }
  }

  const holdings: Holding[] = Object.values(tokenMap).map((item) => {
    const pricePerShareUsdE18 =
      pricesByTickerE18[item.ticker] ??
      (item.balanceShares > 0n ? mulDiv(item.costBasisUsdE18, E18, item.balanceShares) : 0n);
    const tokenBalanceUsdE18 = mulDiv(item.balanceShares, pricePerShareUsdE18, E18);
    const avgCostPerShareUsdE18 =
      item.balanceShares > 0n ? mulDiv(item.costBasisUsdE18, E18, item.balanceShares) : null;
    const unrealizedPnlUsdE18 = tokenBalanceUsdE18 - item.costBasisUsdE18;

    return {
      tokenContractAddress: item.tokenContractAddress,
      tokenSymbol: item.tokenSymbol,
      ticker: item.ticker,
      issuer: item.issuer,
      isRecognized: true,
      balanceTokens: item.balanceTokens,
      multiplier: item.multiplier,
      balanceShares: item.balanceShares,
      convertedAtTodaysRatio: false,
      tokenBalanceUsdE18,
      pricePerShareUsdE18,
      costBasisUsdE18: item.costBasisUsdE18,
      avgCostPerShareUsdE18,
      unrealizedPnlUsdE18,
      source: "receipts",
      rowActionsSlot: {
        token: item.tokenContractAddress,
        issuer: item.issuer,
        balanceTokens: formatUnits(item.balanceTokens, 18, 4),
        balanceShares: formatUnits(item.balanceShares, 18, 4),
        ticker: item.ticker,
      },
    };
  });

  return { holdings, trades };
}

/**
 * statement():
 * Computes portfolio statement aggregating holdings in shares per ticker across issuers,
 * average cost per share, realized and unrealized P&L, reconciliation against receipts (>1% discrepancy flag),
 * and graceful fallback when API fails. All arithmetic is in exact 1e18 bigint fixed-point.
 */
export function statement(options: StatementOptions): Statement {
  const { walletAddress, pricesByTickerE18 = {}, apiFailed = false } = options;

  let holdings = options.holdings ?? [];
  let trades = options.trades ?? [];
  const pnlLines = options.pnlLines ?? [];
  const receipts = options.receipts ?? [];
  const notes: string[] = [];
  let source: "api" | "receipts" | "mixed" = "api";

  const asOf = options.asOf !== undefined ? options.asOf : null;
  const asOfReason =
    asOf === null ? (options.asOfReason ?? "No observation timestamp available") : undefined;

  // Check if API failed or returned nothing while receipts exist
  const hasApiData = holdings.length > 0 || trades.length > 0 || pnlLines.length > 0;
  const isApiUnavailable = apiFailed || (!hasApiData && receipts.length > 0);

  if (isApiUnavailable && receipts.length > 0) {
    const synthesized = synthesizeFromReceipts(receipts, pricesByTickerE18);
    holdings = synthesized.holdings;
    trades = synthesized.trades;
    source = "receipts";
    notes.push("Generated from onchain receipts only (Binance API unavailable).");
  } else if (receipts.length > 0 && hasApiData) {
    source = "mixed";
  }

  // Count conversions at today's ratio
  let convertedAtTodaysRatioCount = 0;
  for (const h of holdings) {
    if (h.convertedAtTodaysRatio) convertedAtTodaysRatioCount++;
  }
  for (const t of trades) {
    if (t.convertedAtTodaysRatio) convertedAtTodaysRatioCount++;
  }
  if (convertedAtTodaysRatioCount > 0) {
    notes.push(
      `${convertedAtTodaysRatioCount} transaction(s) or holding(s) converted at today's ratio (no multiplier observation recorded at trade time).`,
    );
  }

  // Separate recognized vs unrecognized holdings
  const recognizedHoldings: Holding[] = [];
  const unrecognizedHoldings: Holding[] = [];

  for (const h of holdings) {
    if (h.isRecognized && h.issuer !== null) {
      recognizedHoldings.push(h);
    } else {
      unrecognizedHoldings.push(h);
    }
  }

  if (unrecognizedHoldings.length > 0) {
    notes.push(
      `${unrecognizedHoldings.length} holding(s) not recognized as tokenized stocks: excluded from share totals.`,
    );
  }

  // Group recognized holdings by ticker across issuers
  const holdingsByTicker: Record<string, TickerHoldingsGroup> = {};

  for (const h of recognizedHoldings) {
    const ticker = h.ticker.toUpperCase();
    if (!holdingsByTicker[ticker]) {
      holdingsByTicker[ticker] = {
        ticker,
        totalShares: 0n,
        totalValueUsdE18: 0n,
        totalCostBasisUsdE18: 0n,
        avgCostPerShareUsdE18: null,
        unrealizedPnlUsdE18: 0n,
        issuers: [],
        hasUnavailableShares: false,
        costKnown: true,
      };
    }
    const group = holdingsByTicker[ticker]!;
    if (h.balanceShares !== null) {
      group.totalShares += h.balanceShares;
    } else {
      group.hasUnavailableShares = true;
      notes.push(
        `${h.tokenSymbol} (${h.tokenContractAddress}): shares unavailable (${h.sharesUnavailableReason ?? "unknown reason"}) - excluded from headline share total.`,
      );
    }
    group.totalValueUsdE18 += h.tokenBalanceUsdE18;
    group.totalCostBasisUsdE18 += h.costBasisUsdE18;
    if (h.costKnown === false) group.costKnown = false;
    group.issuers.push(h);
  }

  // Compute average cost per share and unrealized PnL for each ticker group
  for (const group of Object.values(holdingsByTicker)) {
    group.avgCostPerShareUsdE18 =
      group.totalShares > 0n ? mulDiv(group.totalCostBasisUsdE18, E18, group.totalShares) : null;
    group.unrealizedPnlUsdE18 = group.totalValueUsdE18 - group.totalCostBasisUsdE18;
    if (group.costKnown === false) {
      group.avgCostPerShareUsdE18 = null;
      notes.push(
        `${group.ticker}: more tokens are held than the recorded purchases explain (received from another wallet), so its cost and gain are not shown.`,
      );
    }
  }

  // Calculate totals across all recognized holdings
  let totalValueUsdE18 = 0n;
  let totalCostBasisUsdE18 = 0n;
  let knownValueUsdE18 = 0n;
  for (const h of holdings) {
    totalValueUsdE18 += h.tokenBalanceUsdE18;
    // Positions with an unknowable cost stay in the value but out of the cost and gain totals.
    if (h.costKnown === false) continue;
    totalCostBasisUsdE18 += h.costBasisUsdE18;
    knownValueUsdE18 += h.tokenBalanceUsdE18;
  }
  const totalUnrealizedPnlUsdE18 = knownValueUsdE18 - totalCostBasisUsdE18;

  // Realized P&L
  let apiRealizedPnlE18 = 0n;
  if (pnlLines.length > 0) {
    apiRealizedPnlE18 = pnlLines.reduce((acc, l) => acc + l.realizedPnlUsdE18, 0n);
  } else if (trades.length > 0) {
    apiRealizedPnlE18 = trades.reduce((acc, t) => acc + (t.realizedPnlUsdE18 ?? 0n), 0n);
  }

  let totalRealizedPnlUsdE18 = apiRealizedPnlE18;
  let differsFromApi = false;
  let differsFromApiNote: string | undefined;

  // Reconcile with receipts if available
  if (receipts.length > 0) {
    const receiptsRealizedPnlE18 = calculateReceiptsRealizedPnl(receipts);

    if (source !== "receipts") {
      const diffE18 =
        apiRealizedPnlE18 > receiptsRealizedPnlE18
          ? apiRealizedPnlE18 - receiptsRealizedPnlE18
          : receiptsRealizedPnlE18 - apiRealizedPnlE18;
      const absApi = apiRealizedPnlE18 < 0n ? -apiRealizedPnlE18 : apiRealizedPnlE18;
      const absRec = receiptsRealizedPnlE18 < 0n ? -receiptsRealizedPnlE18 : receiptsRealizedPnlE18;
      const denomE18 =
        absApi > absRec ? (absApi > E18 ? absApi : E18) : absRec > E18 ? absRec : E18;

      const diffBps = mulDiv(diffE18, 10_000n, denomE18);

      if (diffBps > 100n) {
        // > 1%
        differsFromApi = true;
        const pctStr = (Number(diffBps) / 100).toFixed(2);
        differsFromApiNote = `Realized P&L differs from Binance API figure by ${pctStr}% (Receipts: $${formatUsd(receiptsRealizedPnlE18)} vs API: $${formatUsd(apiRealizedPnlE18)}). Using share-true receipts.`;
        notes.push(differsFromApiNote);
        totalRealizedPnlUsdE18 = receiptsRealizedPnlE18;
      }
    } else {
      totalRealizedPnlUsdE18 = receiptsRealizedPnlE18;
    }
  }

  return {
    walletAddress,
    asOf,
    asOfReason,
    holdingsByTicker,
    holdings,
    unrecognizedHoldings,
    trades,
    pnlLines,
    totalValueUsdE18,
    totalCostBasisUsdE18,
    totalRealizedPnlUsdE18,
    totalUnrealizedPnlUsdE18,
    differsFromApi,
    differsFromApiNote,
    convertedAtTodaysRatioCount,
    notes,
    source,
  };
}
