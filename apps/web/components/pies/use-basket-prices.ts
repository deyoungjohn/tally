"use client";
// Per-share prices for the legs of a basket, read from the quote route (a $6 quote per stock, the same one the buy flow starts
// from). They only feed the "about N shares" preview: a stock whose price cannot be read says so, and nothing is guessed.

import { useEffect, useState } from "react";
import type { QuoteDto } from "@/lib/dto";

const REFRESH_MS = 30_000;

export function usePerShareE18(
  tickers: readonly string[],
  issuerSuffix = "B",
): Record<string, bigint | null> {
  const key = tickers.join(",");
  const [prices, setPrices] = useState<Record<string, bigint | null>>({});
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const load = async () => {
      const entries = await Promise.all(
        key.split(",").map(async (ticker) => {
          try {
            const res = await fetch(`/api/quote?ticker=${encodeURIComponent(ticker)}&usd=6`, {
              cache: "no-store",
            });
            if (!res.ok) return [ticker, null] as const;
            const quote = (await res.json()) as QuoteDto;
            const row = quote.rows.find((r) => r.symbol === `${ticker}${issuerSuffix}`);
            const p = row?.usdPerShare;
            return [
              ticker,
              typeof p === "number" && p > 0 ? BigInt(Math.round(p * 1e6)) * 10n ** 12n : null,
            ] as const;
          } catch {
            return [ticker, null] as const;
          }
        }),
      );
      if (alive) setPrices(Object.fromEntries(entries));
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [key, issuerSuffix]);
  return prices;
}
