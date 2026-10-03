"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiError, QuoteDto } from "@/lib/dto";

export const QUOTE_POLL_MS = 10_000;

export type QuoteAmount = { usd: number } | { shares: number };

/**
 * Polls /api/quote every 10 s while the tab is visible and stops while it is hidden (blueprint §7.7). Keeps the last good
 * quote on screen while a new one loads or fails, so numbers never vanish mid-read. `paused` freezes polling
 * (the confirm step must never move under the user's finger, DESIGN §3.3).
 */
export function useLiveQuote(ticker: string, amount: QuoteAmount | null, paused = false) {
  const [data, setData] = useState<QuoteDto | null>(null);
  const [error, setError] = useState<ApiError["error"] | null>(null);
  const [loading, setLoading] = useState(false);
  const key = amount ? ("usd" in amount ? `usd=${amount.usd}` : `shares=${amount.shares}`) : "";
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!key) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setLoading(true);
    try {
      const res = await fetch(`/api/quote?ticker=${encodeURIComponent(ticker)}&${key}`, {
        signal: ctl.signal,
        cache: "no-store",
      });
      const body = (await res.json()) as QuoteDto | ApiError;
      if (ctl.signal.aborted) return;
      if (!res.ok) setError((body as ApiError).error);
      else {
        setData(body as QuoteDto);
        setError(null);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError({ kind: "network", message: "We couldn't reach the price source. Retrying…" });
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [ticker, key]);

  useEffect(() => {
    if (!key || paused) return;
    // Debounce typing: wait for a pause before asking.
    const first = setTimeout(() => void load(), 350);
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, QUOTE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      abort.current?.abort();
    };
  }, [key, paused, load]);

  return { data, error, loading, refresh: load };
}
