import { formatShares, type ConsolidatedQuote, type QuoteRow } from "@tally/core";

const usd = (n: number | undefined, d = 2) =>
  n === undefined
    ? "–"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const pct = (n: number | undefined) =>
  n === undefined ? "–" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
const ISSUER: Record<string, string> = { ondo: "Ondo", bstock: "bStock", xstocks: "xStocks" };

function pad(s: string, w: number, right = false) {
  return right ? s.padStart(w) : s.padEnd(w);
}

function table(rows: string[][], right: boolean[]): string[] {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
  return rows.map((r, i) => {
    const line = r
      .map((cell, c) => pad(cell, widths[c]!, right[c]))
      .join("  ")
      .trimEnd();
    return i === 0 ? line : line;
  });
}

function rowCells(r: QuoteRow): string[] {
  const name = `${r.symbol} (${ISSUER[r.issuer] ?? r.issuer})${r.isBest ? " ★ Best" : ""}`;
  const grade = `${r.integrity.grade}${r.integrity.unitTrap ? " ⚠unit" : ""}${r.integrity.flags.includes("ghost") ? " ⚠ghost" : ""}`;
  if (r.sharesOut === undefined)
    return [name, "–", "–", "–", "–", r.notExecutableReason ?? "–", grade];
  return [
    name,
    formatShares(r.sharesOut, r.decimals),
    usd(r.usdPerShare),
    pct(r.premium),
    r.feeUsd === undefined ? "–" : `≈${usd(r.feeUsd, 3)}`,
    `${r.routeText}${r.executable ? "" : `  [${r.notExecutableReason}]`}`,
    grade,
  ];
}

/** Plain-text comparison for the CLI. Shares, price per share, premium vs the US price, ≈fee, route, integrity grade (exit check 1). */
export function formatQuote(q: ConsolidatedQuote): string {
  const amt = "usd" in q.amount ? `$${q.amount.usd}` : `${q.amount.shares} shares`;
  const out: string[] = [];
  out.push(
    `${q.ticker}: ${amt} · US price ${q.referencePrice === null ? "n/a" : usd(q.referencePrice)} per share · session ${q.session} · ${q.asOf}`,
  );
  out.push("");
  const rows = [
    ["Token", "Shares", "$/share", "vs US", "Fee", "Route", "Grade"],
    ...q.rows.map(rowCells),
  ];
  out.push(...table(rows, [false, true, true, true, true, false, false]));
  const unmetered = q.rows.filter((r) => r.integrity.reasons.length > 0);
  if (unmetered.length) {
    out.push("", "Integrity notes:");
    for (const r of unmetered)
      for (const d of r.integrity.reasons)
        out.push(
          `  ${r.symbol} ${r.integrity.grade}: ${d.reason}${d.points ? ` (−${d.points})` : ""}`,
        );
  }
  for (const r of q.rows)
    if (r.error) out.push(`  ${r.symbol}: ${r.error.kind}: ${r.error.message}`);
  if (q.saving)
    out.push(
      "",
      `${q.best} saves ${usd(q.saving.usd, 4)} (${(q.saving.pct * 100).toFixed(2)}%) vs ${q.saving.vsSymbol} for the same shares, fee included.`,
    );
  for (const w of q.warnings) out.push(`! ${w}`);
  return out.join("\n");
}
