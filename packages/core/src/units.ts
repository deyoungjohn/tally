/** Fixed-point helpers. All token and share amounts are bigint in the token's own decimals. */

export const E18 = 10n ** 18n;

/** Parse a plain decimal string ("1.0017152487959898", "10", "0.5") into a bigint with `decimals` places. Extra digits are truncated. */
export function parseDecimal(input: string, decimals: number): bigint {
  const s = input.trim();
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`not a plain decimal: ${JSON.stringify(input)}`);
  const [, sign, whole, frac = ""] = m;
  const scaled =
    BigInt(whole!) * 10n ** BigInt(decimals) +
    BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
  return sign ? -scaled : scaled;
}

export function formatUnits(value: bigint, decimals: number, maxFraction = decimals): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base)
    .toString()
    .padStart(decimals, "0")
    .slice(0, maxFraction)
    .replace(/0+$/, "");
  if (maxFraction === 0) frac = "";
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/** Lossy conversion for display maths only; never feed the result back into token maths. */
export function toNumber(value: bigint, decimals: number): number {
  return Number(formatUnits(value, decimals));
}

/** floor(a * b / c) without intermediate overflow concerns. */
export function mulDiv(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new Error("mulDiv: division by zero");
  return (a * b) / c;
}

/** ceil(a * b / c). */
export function mulDivUp(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new Error("mulDivUp: division by zero");
  return (a * b + c - 1n) / c;
}
