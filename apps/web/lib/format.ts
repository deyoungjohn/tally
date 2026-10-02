export const fmtUsd = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "–"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

/** Shares are small numbers for small buys: show enough digits to tell them apart (0.025705, not 0.03). */
export const fmtShares = (n: number | null | undefined) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const d = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};

export const fmtPct = (f: number | null | undefined, d = 2) =>
  f === null || f === undefined || !Number.isFinite(f)
    ? "–"
    : `${f > 0 ? "+" : f < 0 ? "−" : ""}${Math.abs(f * 100).toFixed(d)}%`;

/** 18-decimal integer string to a number (display only). */
export const fromWei = (s: string | bigint) => Number(BigInt(s)) / 1e18;

export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

export const ISSUER_LABEL: Record<string, string> = {
  ondo: "Ondo",
  bstock: "bStock",
  xstocks: "xStocks",
};

/** Plain-English session label. */
export const SESSION_LABEL: Record<string, string> = {
  regular: "Market open",
  premarket: "Pre-market",
  postmarket: "After hours",
  overnight: "Overnight",
  closed: "Market closed",
  unknown: "Market status unknown",
};
