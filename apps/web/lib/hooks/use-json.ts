"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiError } from "@/lib/dto";

/** Fetch JSON once (and again on `reload`). `url` null means "don't fetch yet". Keeps the last good data while reloading. */
export function useJson<T>(url: string | null, opts: { refreshMs?: number } = {}) {
  const { refreshMs } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!url) {
      setData(null);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    fetch(url, { signal: ctl.signal, cache: "no-store" })
      .then(async (r) => {
        const body = (await r.json()) as T | ApiError;
        if (!r.ok) throw new Error((body as ApiError).error?.message ?? "Something went wrong.");
        setData(body as T);
        setError(null);
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== "AbortError")
          setError(e instanceof Error ? e.message : "Something went wrong.");
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [url, n]);

  // Live readings: refetch on an interval while the tab is visible, and once more when it becomes visible again.
  useEffect(() => {
    if (!url || !refreshMs) return;
    const tick = () => {
      if (document.visibilityState === "visible") setN((x) => x + 1);
    };
    const id = window.setInterval(tick, refreshMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [url, refreshMs]);

  return { data, error, loading, reload: useCallback(() => setN((x) => x + 1), []) };
}
