import { formatUnits } from "@tally/core";
import { formatUsd } from "./statement";
import type { Statement } from "./types";

/** Escape a value for RFC 4180 CSV compliance */
function escapeCsv(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * exportStatementCsv(statement):
 * Generates a clean, pure RFC 4180 compliant CSV string
 * containing summary totals, holdings in shares, and trade ledger.
 */
export function exportStatementCsv(stmt: Statement): string {
  const lines: string[] = [];

  // 1. Metadata & Summary
  lines.push("# Tally Portfolio Statement");
  lines.push(`Wallet,${escapeCsv(stmt.walletAddress)}`);
  lines.push(
    `As Of,${escapeCsv(stmt.asOf ? new Date(stmt.asOf).toISOString() : (stmt.asOfReason ?? "unknown"))}`,
  );
  lines.push(`Source,${escapeCsv(stmt.source)}`);
  lines.push(`Total Value (USD),${escapeCsv(formatUsd(stmt.totalValueUsdE18))}`);
  lines.push(`Total Cost Basis (USD),${escapeCsv(formatUsd(stmt.totalCostBasisUsdE18))}`);
  lines.push(`Total Realized P&L (USD),${escapeCsv(formatUsd(stmt.totalRealizedPnlUsdE18))}`);
  lines.push(`Total Unrealized P&L (USD),${escapeCsv(formatUsd(stmt.totalUnrealizedPnlUsdE18))}`);
  lines.push(`Differs From API,${escapeCsv(stmt.differsFromApi)}`);
  if (stmt.notes.length > 0) {
    lines.push(`Notes,${escapeCsv(stmt.notes.join("; "))}`);
  }
  lines.push("");

  // 2. Holdings Table
  lines.push("# Holdings");
  lines.push(
    [
      "Ticker",
      "Issuer",
      "Token Symbol",
      "Contract Address",
      "Tokens",
      "Multiplier",
      "Shares",
      "Price Per Share (USD)",
      "Current Value (USD)",
      "Avg Cost Per Share (USD)",
      "Unrealized P&L (USD)",
      "Converted At Today Ratio",
    ]
      .map(escapeCsv)
      .join(","),
  );

  for (const h of stmt.holdings) {
    lines.push(
      [
        h.ticker,
        h.issuer ?? "unrecognized",
        h.tokenSymbol,
        h.tokenContractAddress,
        formatUnits(h.balanceTokens, 18, 6),
        h.multiplier !== null ? formatUnits(h.multiplier, 18, 6) : "unavailable",
        h.balanceShares !== null ? formatUnits(h.balanceShares, 18, 6) : "unavailable",
        h.pricePerShareUsdE18 !== null ? formatUsd(h.pricePerShareUsdE18) : "-",
        formatUsd(h.tokenBalanceUsdE18),
        h.avgCostPerShareUsdE18 !== null ? formatUsd(h.avgCostPerShareUsdE18) : "-",
        formatUsd(h.unrealizedPnlUsdE18),
        h.convertedAtTodaysRatio,
      ]
        .map(escapeCsv)
        .join(","),
    );
  }
  lines.push("");

  // 3. Activity / Trades Table
  lines.push("# Activity / Trades");
  lines.push(
    [
      "Date",
      "Ticker",
      "Issuer",
      "Type",
      "Tokens",
      "Multiplier",
      "Shares",
      "Price Per Share (USD)",
      "Value (USD)",
      "Realized P&L (USD)",
      "Today Ratio",
      "Tx Hash",
    ]
      .map(escapeCsv)
      .join(","),
  );

  for (const t of stmt.trades) {
    lines.push(
      [
        new Date(t.time).toISOString(),
        t.ticker,
        t.issuer ?? "unrecognized",
        t.type,
        formatUnits(t.amountTokens, 18, 6),
        t.multiplier !== null ? formatUnits(t.multiplier, 18, 6) : "unavailable",
        t.amountShares !== null ? formatUnits(t.amountShares, 18, 6) : "unavailable",
        t.pricePerShareUsdE18 !== null ? formatUsd(t.pricePerShareUsdE18) : "-",
        formatUsd(t.valueUsdE18),
        t.realizedPnlUsdE18 !== undefined ? formatUsd(t.realizedPnlUsdE18) : "-",
        t.convertedAtTodaysRatio,
        t.txHash,
      ]
        .map(escapeCsv)
        .join(","),
    );
  }

  return lines.join("\r\n");
}
