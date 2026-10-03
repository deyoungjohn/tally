import { formatUnits } from "@tally/core";
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
  lines.push(`As Of,${escapeCsv(new Date(stmt.asOf).toISOString())}`);
  lines.push(`Source,${escapeCsv(stmt.source)}`);
  lines.push(`Total Value (USD),${escapeCsv(stmt.totalValueUsd.toFixed(2))}`);
  lines.push(`Total Cost Basis (USD),${escapeCsv(stmt.totalCostBasisUsd.toFixed(2))}`);
  lines.push(`Total Realized P&L (USD),${escapeCsv(stmt.totalRealizedPnlUsd.toFixed(2))}`);
  lines.push(`Total Unrealized P&L (USD),${escapeCsv(stmt.totalUnrealizedPnlUsd.toFixed(2))}`);
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
        h.issuer,
        h.tokenSymbol,
        h.tokenContractAddress,
        formatUnits(h.balanceTokens, 18, 6),
        formatUnits(h.multiplier, 18, 6),
        formatUnits(h.balanceShares, 18, 6),
        h.pricePerShareUsd.toFixed(2),
        h.tokenBalanceUsd.toFixed(2),
        h.avgCostPerShareUsd.toFixed(2),
        h.unrealizedPnlUsd.toFixed(2),
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
        t.issuer,
        t.type,
        formatUnits(t.amountTokens, 18, 6),
        formatUnits(t.multiplier, 18, 6),
        formatUnits(t.amountShares, 18, 6),
        t.pricePerShareUsd.toFixed(2),
        t.valueUsd.toFixed(2),
        t.realizedPnlUsd !== undefined ? t.realizedPnlUsd.toFixed(2) : "",
        t.convertedAtTodaysRatio,
        t.txHash,
      ]
        .map(escapeCsv)
        .join(","),
    );
  }

  return lines.join("\r\n");
}
