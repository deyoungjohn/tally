import type { StatementVM } from "@/modules/statement/view-model";

const csvCell = (v: string | null | undefined) => {
  const s = v ?? "";
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The CSV the statement module built, with its trades section rewritten from the lines shown (feed plus verified Activity). */
export function csvWithLines(vm: StatementVM, lines: StatementVM["lines"]): string {
  const marker = "# Activity / Trades";
  const at = vm.csv.content.indexOf(marker);
  const head =
    at < 0
      ? `# Tally Portfolio Statement\r\nWallet,${csvCell(vm.walletAddress)}\r\nAs Of,${new Date().toISOString()}\r\n\r\n`
      : vm.csv.content.slice(0, at);
  const header = [
    "Date",
    "Ticker",
    "Issuer",
    "Type",
    "Tokens",
    "Multiplier",
    "Shares",
    "Price Per Share (USD)",
    "Value (USD)",
    "Today Ratio",
    "Tx Hash",
  ];
  const rows = lines.map((l) =>
    [
      l.date,
      l.ticker,
      l.issuer ?? "unrecognized",
      l.type,
      l.amountTokens,
      l.multiplier,
      l.amountShares,
      l.pricePerShareUsd,
      l.valueUsd,
      String(l.convertedAtTodaysRatio),
      l.txHash ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [head + marker, header.map(csvCell).join(","), ...rows].join("\r\n");
}
