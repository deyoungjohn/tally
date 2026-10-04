import { formatUnits } from "@tally/core";
import { QUOTE_FRESH_MS } from "@tally/engine";
import { freshness } from "../freshness";
import { object, only, positive, ticker } from "../input";
import { ToolError, plainError } from "../errors";
import type { Runtime } from "../runtime";

export async function getConsolidatedQuote(runtime: Runtime, input: unknown) {
  const args = object(input);
  only(args, ["ticker", "usd", "shares"]);
  if ((args.usd === undefined) === (args.shares === undefined))
    throw new ToolError("invalid_request", "Provide exactly one of usd or shares.");
  const amount =
    args.usd !== undefined
      ? { usd: positive(args.usd, "usd") }
      : { shares: positive(args.shares, "shares") };
  const quote = await runtime.engine.quote({ ticker: ticker(args.ticker), amount });
  return {
    ...quote,
    freshness: freshness(runtime, quote.asOf, QUOTE_FRESH_MS),
    rows: quote.rows.map((row) => ({
      ...row,
      best: row.isBest,
      shares: row.sharesOut === undefined ? null : formatUnits(row.sharesOut, row.decimals),
      pricePerShare: row.usdPerShare ?? null,
      premium: row.premium ?? null,
      fee: row.feeUsd ?? null,
      feeEstimated: true,
      route: row.routeText ?? null,
      reason: row.notExecutableReason ?? (row.error ? plainError(row.error).message : null),
      error: row.error ? plainError(row.error) : undefined,
    })),
  };
}
