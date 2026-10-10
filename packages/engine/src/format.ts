import {
  formatShares,
  formatUnits,
  type CheckRecord,
  type ConsolidatedQuote,
  type QuoteRow,
  type TokenInspection,
} from "@tally/core";

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

const MARK: Record<CheckRecord["outcome"], string> = {
  pass: "✓",
  deduct: "−",
  flag: "⚑",
  skipped: "·",
};

/** The integrity log, one line per check: ✓ pass, − deduction, ⚑ flag, · skipped. Every check appears, whatever its outcome. */
export function formatChecks(checks: CheckRecord[], indent = "    "): string[] {
  return checks.map((c) => `${indent}${MARK[c.outcome]} ${c.id.padEnd(22)} ${c.summary}`);
}

/** `tally quote --checks`: the log under the table for every row. */
export function formatQuoteChecks(q: ConsolidatedQuote): string {
  const out: string[] = ["", "Integrity checks (✓ pass  − deduction  ⚑ flag  · skipped):"];
  for (const r of q.rows) {
    out.push(
      `  ${r.symbol}: ${r.integrity.grade} (${r.integrity.score})`,
      ...formatChecks(r.integrity.checks),
    );
  }
  return out.join("\n");
}

const num = (v: bigint | undefined) => (v === undefined ? "–" : formatUnits(v, 18, 8));

/** `tally facts`: everything the grade is built from, per token, with the check log. */
export function formatFacts(ticker: string, tokens: TokenInspection[], now: number): string {
  const out: string[] = [`${ticker.toUpperCase()} facts as of ${new Date(now).toISOString()}`];
  const ref = tokens[0]?.referencePrice;
  out.push(
    `US reference price: ${ref ? `$${ref.price.toFixed(2)} per share, session ${ref.session}` : "none"}`,
  );
  for (const t of tokens) {
    out.push("", `${t.symbol} (${ISSUER[t.issuer] ?? t.issuer})  ${t.address}`);
    out.push(
      `  executable: ${t.executable ? "yes" : `no (${t.blockedReason ?? "not executable"})`}`,
    );
    const r = t.readings;
    out.push(
      `  multiplier readings: onchain ${num(r.onchain)}, api ${num(r.api)}, list ${num(r.list)}${t.multiplier ? `  → using ${t.multiplier.source} ${num(t.multiplier.value)}${t.multiplier.degraded ? " (degraded)" : ""}` : "  → none"}`,
    );
    const s = t.facts.status;
    out.push(
      `  status: ${s ? `${s.kind} (${s.reasonCode ?? "no code"}), session ${s.session}${s.reasonMsg ? `, "${s.reasonMsg}"` : ""}` : "unknown"}`,
    );
    out.push(
      `  listed token price: ${t.facts.listedTokenPrice === undefined ? "–" : `$${t.facts.listedTokenPrice.toFixed(2)}`}   onchain volume 24h: ${t.facts.onchainVolume24hUsd === undefined ? "–" : `$${Math.round(t.facts.onchainVolume24hUsd).toLocaleString("en-US")}`}`,
    );
    const a = t.facts.attestation;
    out.push(`  attestation: ${a ? `report ${a.reportDate} (${a.url})` : "none"}`);
    const b = t.facts.multiplierBaseline;
    out.push(
      `  baseline: ${b ? `${num(b.value)} seen ${new Date(b.at).toISOString().slice(0, 10)}` : t.issuer === "ondo" ? "none" : "n/a"}`,
    );
    const ca = t.facts.corporateAction;
    if (t.issuer === "ondo") {
      out.push(
        `  corporate action: ${ca ? `${ca.kind} seen ${new Date(ca.firstSeenAt).toISOString().slice(0, 16)}Z to ${new Date(ca.lastSeenAt).toISOString().slice(0, 16)}Z` : "none seen"}`,
      );
      out.push(
        `  multiplier last changed (Binance lastUpdateTime): ${t.facts.multiplierChangedAt ? new Date(t.facts.multiplierChangedAt).toISOString().slice(0, 16) + "Z" : "not stated"}`,
      );
    }
    for (const [k, why] of Object.entries(t.facts.notes ?? {})) out.push(`  note (${k}): ${why}`);
    out.push(
      `  integrity ${t.integrity.grade} (${t.integrity.score}):`,
      ...formatChecks(t.integrity.checks),
    );
  }
  return out.join("\n");
}
