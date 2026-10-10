import { formatUnits } from "@tally/core";
import { freshness } from "../freshness";
import { address, object, only, tickers } from "../input";
import type { Runtime } from "../runtime";

export async function getSharesOf(runtime: Runtime, input: unknown) {
  const args = object(input);
  only(args, ["address", "tickers"]);
  const report = await runtime.engine.sharesOf(address(args.address), tickers(args.tickers));
  return {
    ...report,
    units: "shares and multiplier: 1e18 fixed point; balance: raw token decimals",
    freshness: freshness(runtime, report.asOf, 300_000),
    rows: report.rows.map((row) => ({
      ...row,
      sharesDisplay: row.shares === null ? null : formatUnits(row.shares, 18),
      multiplierDisplay: row.multiplier === null ? null : formatUnits(row.multiplier, 18),
      sourceDetail:
        row.source === "onchain"
          ? row.issuer === "bstock"
            ? "onchain uiMultiplier()"
            : "onchain multiplier(); display only"
          : row.source === null
            ? null
            : row.issuer === "ondo"
              ? `${row.source}; Ondo readings checked against the accepted baseline`
              : `${row.source} fallback; preferred onchain multiplier unavailable`,
    })),
  };
}
