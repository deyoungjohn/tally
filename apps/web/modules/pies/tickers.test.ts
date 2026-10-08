import { expect, it, vi } from "vitest";

const { overrides, cleaning } = vi.hoisted(() => ({
  overrides: [
    ["NVDA", "NVIDIA"],
    ["AAPL", "Apple"],
    ["TSLA", "Tesla"],
    ["QQQ", "Invesco QQQ"],
    ["SPY", "SPDR S&P 500"],
    ["TSM", "TSMC"],
    ["NFLX", "Netflix"],
    ["GOOGL", "Alphabet"],
    ["AMZN", "Amazon"],
    ["MSFT", "Microsoft"],
    ["META", "Meta"],
    ["HOOD", "Robinhood"],
    ["CRCL", "Circle"],
    ["BABA", "Alibaba"],
    ["INTC", "Intel"],
    ["GME", "GameStop"],
    ["MSTR", "Strategy"],
    ["SNDK", "SanDisk"],
    ["SKHY", "SK Hynix"],
    ["BMNR", "BitMine"],
  ],
  cleaning: [
    ["Acme Inc.", "Acme"],
    ["Acme Corp", "Acme"],
    ["Acme Corporation", "Acme"],
    ["Acme Ltd", "Acme"],
    ["Acme Limited", "Acme"],
    ["Acme Co", "Acme"],
    ["Acme Company", "Acme"],
    ["Acme Holdings", "Acme"],
    ["Acme Group", "Acme"],
    ["  Acme Holdings Group, Inc.,  ", "Acme"],
    ["Acme Co. Ltd.", "Acme"],
    ["Acme,Inc.", "Acme"],
    ["Acme cOrPoRaTiOn...", "Acme"],
    ["Acme,.,", "Acme"],
    ["SpaceX", "SpaceX"],
    ["Group One Company", "Group One"],
    ["Company of Heroes Ltd.", "Company of Heroes"],
    ["Incorporated Widgets", "Incorporated Widgets"],
    ["Acme Groupware", "Acme Groupware"],
  ],
}));

// Exercise the real BUYABLE_TICKERS mapping with constructed registry names.
vi.mock("../../lib/buyable.generated", () => ({
  GENERATED_BUYABLE_TICKERS: [
    ...overrides.map(([ticker]) => ({ ticker, name: `Different legal name for ${ticker} Inc.` })),
    ...cleaning.map(([name], index) => ({ ticker: `CLEAN${index}`, name })),
  ],
}));

import { BUYABLE_TICKERS, nameOf, PICKER_TICKERS } from "../../lib/tickers";

it.each(overrides)("uses the curated display name for %s", (ticker, expected) => {
  expect(nameOf(ticker!)).toBe(expected);
});

it.each(cleaning.map(([name, expected], index) => [name, expected, index] as const))(
  "cleans trailing corporate suffixes and punctuation from %s",
  (_registryName, expected, index) => {
    expect(nameOf(`CLEAN${index}`)).toBe(expected);
  },
);

it("preserves only ticker/name fields and includes each picker ticker once", () => {
  for (const entry of BUYABLE_TICKERS) expect(Object.keys(entry)).toEqual(["ticker", "name"]);
  expect(PICKER_TICKERS).toEqual(BUYABLE_TICKERS);
  expect(new Set(PICKER_TICKERS.map((entry) => entry.ticker)).size).toBe(PICKER_TICKERS.length);
});
