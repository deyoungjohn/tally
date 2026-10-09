"use client";
// One icon per stock, the same for every issuer (NVDAon, NVDAB and NVDAx all show NVDA). The files are in public/tokens and the
// generated set says which tickers have one, so a missing file never makes a request. Without a file, or if it fails to load, a
// faint white circle with the first letter stands in at the same size. The icon is decorative: the name beside it is the label.

import { useState } from "react";
import { fallbackLetter, iconFileFor } from "@/lib/token-icon-helpers";
import { tickerOf } from "@/lib/tickers";
import { cn } from "@/lib/utils";

export type TokenIconSize = 16 | 20 | 24 | 32 | 40;

export function TokenIcon({
  ticker,
  symbol,
  size = 24,
  className,
}: {
  /** The stock ticker (NVDA), used as given. Or give `symbol` (NVDAon) and the ticker is looked up in the registry. */
  ticker?: string;
  symbol?: string;
  size?: TokenIconSize;
  className?: string;
}) {
  const t = ticker ? ticker.trim().toUpperCase() : tickerOf(symbol ?? "");
  const file = iconFileFor(t);
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };
  if (file && !failed)
    return (
      <img
        src={`/tokens/${file}`}
        {...box}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        className={cn("token-icon shrink-0 rounded-full", className)}
        data-testid={`token-icon-${t}`}
      />
    );
  return (
    <span
      aria-hidden
      style={{ ...box, fontSize: Math.round(size * 0.46) }}
      className={cn("token-icon token-icon-fallback", className)}
      data-letter={fallbackLetter(t)}
      data-testid={`token-icon-${t}`}
    />
  );
}
