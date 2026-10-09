"use client";
// Colour for a live price: green when the latest reading is above the one before, red when below, white when equal.
// Pass `tick` (anything whose identity changes with every fresh reading, such as the fetched row) so a reading that did
// not move counts as a tick too and turns the price white; without it only a changed value counts.

import { useEffect, useRef, useState } from "react";

export type Trend = "up" | "down" | "flat";

export function trendOf(previous: number | null, next: number): Trend {
  if (previous === null || next === previous) return "flat";
  return next > previous ? "up" : "down";
}

export function usePriceTrend(value: number | null | undefined, tick?: unknown): Trend {
  const [trend, setTrend] = useState<Trend>("flat");
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    setTrend(trendOf(prev.current, value));
    prev.current = value;
  }, [value, tick]);
  return trend;
}

export const TREND_CLASS: Record<Trend, string> = {
  up: "text-up",
  down: "text-red",
  flat: "text-white",
};
