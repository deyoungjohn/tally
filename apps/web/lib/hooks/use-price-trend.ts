"use client";
// Colour for a live price: green when it just ticked up, red when it ticked down, white when it has not moved.
// A reading counts as flat once it has held for longer than one refresh, so a steady price returns to white.

import { useEffect, useRef, useState } from "react";

export type Trend = "up" | "down" | "flat";
export const FLAT_AFTER_MS = 12_000;

export function usePriceTrend(value: number | null | undefined): Trend {
  const [trend, setTrend] = useState<Trend>("flat");
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    const before = prev.current;
    prev.current = value;
    if (before !== null && value !== before) setTrend(value > before ? "up" : "down");
    const t = window.setTimeout(() => setTrend("flat"), FLAT_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [value]);
  return trend;
}

export const TREND_CLASS: Record<Trend, string> = {
  up: "text-up",
  down: "text-red",
  flat: "text-white",
};
