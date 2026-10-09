import { GENERATED_BUYABLE_ISSUERS, GENERATED_BUYABLE_TICKERS } from "./buyable.generated";

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
/** Only issuers in the verified manifest are eligible as buy destinations. */
export const issuersOf = (ticker: string): readonly ("ondo" | "bstock")[] => {
  const enabled: Readonly<Record<string, readonly ("ondo" | "bstock")[]>> =
    GENERATED_BUYABLE_ISSUERS;
  const key = ticker.toUpperCase();
  return Object.hasOwn(enabled, key) ? enabled[key]! : [];
};
export const isTokenBuyable = (ticker: string, issuer: keyof typeof ISSUER_SUFFIX) =>
  issuersOf(ticker).some((enabled) => enabled === issuer);
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

/**
 * The stock ticker behind a token symbol: NVDAon, NVDAB and NVDAx all give NVDA. Read from the registry's real tickers (the longest
 * ticker plus an issuer suffix that spells the symbol), never from a pattern, because a ticker can itself end in B or x. A symbol that
 * is already a ticker, or matches nothing, comes back upper-cased and unchanged.
 */
export function tickerOf(symbol: string, known: readonly { ticker: string }[] = BUYABLE_TICKERS) {
  const s = symbol.trim();
  const upper = s.toUpperCase();
  const hit = [...known]
    .map((k) => k.ticker)
    .sort((a, b) => b.length - a.length)
    .find((t) =>
      (Object.values(ISSUER_SUFFIX) as string[]).some((suffix) => s === `${t}${suffix}`),
    );
  return hit ?? upper;
}
