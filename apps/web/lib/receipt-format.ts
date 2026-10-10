// How receipts print numbers: amounts and shares to 3 decimals, USDT values up to 2 decimals. Done on the decimal string so no
// float is involved. A guarantee ("at least") is rounded DOWN instead, because rounding it up would promise more than was signed.

type Mode = "round" | "up" | "down";

/** A decimal string to `dp` places with the given rounding; trailing zeros kept so columns line up. */
export function roundDecimal(value: string, dp: number, mode: Mode = "round"): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return value;
  const neg = m[1] === "-";
  const frac = (m[3] ?? "").padEnd(dp + 1, "0");
  let scaled = BigInt(m[2] + frac.slice(0, dp));
  const rest = frac.slice(dp);
  const hasRest = /[1-9]/.test(rest);
  // For a negative number "up"/"down" refer to its magnitude, so a guarantee never grows either way.
  if (mode === "up" ? hasRest : mode === "round" && rest.charCodeAt(0) >= 53) scaled += 1n;
  const digits = scaled.toString().padStart(dp + 1, "0");
  const whole = digits.slice(0, digits.length - dp);
  const out = dp ? `${whole}.${digits.slice(digits.length - dp)}` : whole;
  return neg && /[1-9]/.test(out) ? `-${out}` : out;
}

/** Token and share amounts: up to 3 decimals, trailing zeros dropped. */
const trim = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);
export const dec3 = (v: string | null | undefined) => (v ? trim(roundDecimal(v, 3)) : null);
export const dec3Down = (v: string | null | undefined) =>
  v ? trim(roundDecimal(v, 3, "down")) : null;
/** USDT values: up to 2 decimals. */
export const usdt2 = (v: string | null | undefined) => (v ? roundDecimal(v, 2, "up") : null);
export const usdt2Down = (v: string | null | undefined) => (v ? roundDecimal(v, 2, "down") : null);
