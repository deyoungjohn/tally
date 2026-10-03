import type { ConsolidatedQuote } from "@tally/core";
import type { QuoteDto, RowDto } from "@/lib/dto";

const E18 = 1e18;

export function toQuoteDto(q: ConsolidatedQuote): QuoteDto {
  const rows: RowDto[] = q.rows.map((r) => ({
    symbol: r.symbol,
    issuer: r.issuer,
    executable: r.executable,
    notExecutableReason: r.notExecutableReason,
    shares: r.sharesOut === undefined ? undefined : Number(r.sharesOut) / 10 ** r.decimals,
    amountUsd: r.amountInUsdt === undefined ? undefined : Number(r.amountInUsdt) / E18,
    usdPerShare: r.usdPerShare,
    premium: r.premium,
    hops: r.hops,
    routeText: r.routeText,
    feeUsd: r.feeUsd,
    grade: r.integrity.grade,
    gradeReasons: r.integrity.reasons.map((c) => c.reason ?? c.summary),
    flags: r.integrity.flags,
    unitTrap: r.integrity.unitTrap,
    multiplier: r.multiplier ? Number(r.multiplier.value) / E18 : undefined,
    isBest: r.isBest,
    rank: r.rank,
    error: r.error?.message,
  }));
  return {
    ticker: q.ticker,
    asOf: q.asOf,
    usd: "usd" in q.amount ? q.amount.usd : undefined,
    shares: "shares" in q.amount ? q.amount.shares : undefined,
    referencePrice: q.referencePrice,
    session: q.session,
    rows,
    best: q.best,
    saving: q.saving,
    warnings: q.warnings,
  };
}
