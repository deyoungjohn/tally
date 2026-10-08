import { GENERATED_BUYABLE_TICKERS } from "./buyable.generated";

/** Manifest tickers verified enabled by the recorded after-owner comparison. */
export const BUYABLE_TICKERS = (() => {
  const shortNames: Readonly<Record<string, string>> = {
    NVDA: "NVIDIA",
    AAPL: "Apple",
    TSLA: "Tesla",
    QQQ: "Invesco QQQ",
    SPY: "SPDR S&P 500",
    TSM: "TSMC",
    NFLX: "Netflix",
    GOOGL: "Alphabet",
    AMZN: "Amazon",
    MSFT: "Microsoft",
    META: "Meta",
    HOOD: "Robinhood",
    CRCL: "Circle",
    BABA: "Alibaba",
    INTC: "Intel",
    GME: "GameStop",
    MSTR: "Strategy",
    SNDK: "SanDisk",
    SKHY: "SK Hynix",
    BMNR: "BitMine",
  };

  const cleanName = (registryName: string): string => {
    let name = registryName.trim();
    for (;;) {
      const cleaned = name
        .replace(/[\s,.]+$/, "")
        .replace(/(?:\s+|,\s*)(?:Inc|Corp|Corporation|Ltd|Limited|Co|Company|Holdings|Group)$/i, "")
        .trim();
      if (cleaned === name) return cleaned;
      name = cleaned;
    }
  };

  return GENERATED_BUYABLE_TICKERS.map(({ ticker, name }) => ({
    ticker,
    name: shortNames[ticker] ?? cleanName(name),
  }));
})();

/** No comparison-only tickers remain: NFLX is now in the enabled manifest. */
export const COMPARE_ONLY_TICKERS: readonly { ticker: string; name: string }[] = [];
export const PICKER_TICKERS = [...BUYABLE_TICKERS, ...COMPARE_ONLY_TICKERS] as const;

export const isBuyable = (t: string) => BUYABLE_TICKERS.some((b) => b.ticker === t.toUpperCase());
export const nameOf = (t: string) =>
  BUYABLE_TICKERS.find((b) => b.ticker === t.toUpperCase())?.name ?? t;
export const TICKER_RE = /^[A-Z0-9.]{1,10}$/;

/** The token symbol each issuer uses for a stock: Ondo "NVDAon", bStock "NVDAB", xStocks "NVDAx". The site never shows a bare ticker. */
export const ISSUER_SUFFIX = { ondo: "on", bstock: "B", xstocks: "x" } as const;
export const tokenSymbol = (ticker: string, issuer: keyof typeof ISSUER_SUFFIX) =>
  `${ticker.toUpperCase()}${ISSUER_SUFFIX[issuer]}`;
/** Both buyable tokens of a stock, for places that name the stock before an issuer is chosen. */
export const tokenPair = (ticker: string) =>
  `${tokenSymbol(ticker, "ondo")} / ${tokenSymbol(ticker, "bstock")}`;
