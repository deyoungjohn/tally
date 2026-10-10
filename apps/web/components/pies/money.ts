import { formatUnits } from "@tally/core";

/** A USDT amount in 18-decimal units as dollars with a fixed number of decimals ("6.00", never "6"). */
export const moneyE18 = (value: string | bigint, d = 2): string =>
  Number(formatUnits(BigInt(value), 18, Math.max(d, 2))).toFixed(d);
