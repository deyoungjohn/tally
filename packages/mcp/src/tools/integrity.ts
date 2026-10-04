import { freshness } from "../freshness";
import { object, only, ticker } from "../input";
import type { Runtime } from "../runtime";

export const DEFAULT_TICKERS = ["NVDA", "AAPL", "TSLA", "QQQ", "SPY", "NFLX"] as const;

export async function getIntegrity(runtime: Runtime, input: unknown) {
  const args = object(input);
  only(args, ["ticker"]);
  const report = await runtime.engine.radar(
    args.ticker === undefined ? DEFAULT_TICKERS : [ticker(args.ticker)],
  );
  for (const failure of report.failed) runtime.onWarn(`${failure.ticker}: integrity unavailable.`);
  return {
    ...report,
    freshness: freshness(runtime, report.asOf, 120_000),
    scope: args.ticker === undefined ? DEFAULT_TICKERS : [ticker(args.ticker)],
    rows: report.rows.map((row) => ({
      ...row,
      ghost: row.flags.includes("ghost") ? true : row.volume24hUsd === undefined ? null : false,
      paused: row.status === undefined || row.status === "unknown" ? null : row.status === "paused",
    })),
  };
}
