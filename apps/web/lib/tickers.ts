/** The tickers ShareGuard v1 was deployed with (IDEAS §F11): each as bStock and Ondo. Others show quotes but can't be bought yet. */
export const BUYABLE_TICKERS = [
  { ticker: "NVDA", name: "NVIDIA" },
  { ticker: "AAPL", name: "Apple" },
  { ticker: "TSLA", name: "Tesla" },
  { ticker: "QQQ", name: "Invesco QQQ" },
  { ticker: "SPY", name: "SPDR S&P 500" },
] as const;

/** Shown in pickers for comparison only (the unit-trap example): ShareGuard isn't set up for it, so it can't be bought. */
export const COMPARE_ONLY_TICKERS = [{ ticker: "NFLX", name: "Netflix" }] as const;
export const PICKER_TICKERS = [...BUYABLE_TICKERS, ...COMPARE_ONLY_TICKERS] as const;

export const isBuyable = (t: string) => BUYABLE_TICKERS.some((b) => b.ticker === t.toUpperCase());
export const nameOf = (t: string) =>
  BUYABLE_TICKERS.find((b) => b.ticker === t.toUpperCase())?.name ?? t;
export const TICKER_RE = /^[A-Z0-9.]{1,10}$/;
