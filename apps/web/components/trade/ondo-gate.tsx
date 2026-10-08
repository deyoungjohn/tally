"use client";
// Ondo tokens trade through signed orders (RFQ) outside US market hours, which Tally can't send yet, so selling and
// migrating them waits for the US market to open. The signal is the live quote itself: Binance answers an Ondo route in
// signed-order mode and the engine marks the Ondo row not executable. If the quote can't be read, nothing is disabled
// (the sale itself still refuses with the same plain words).

import type { ReactNode } from "react";
import type { QuoteDto } from "@/lib/dto";
import { useJson } from "@/lib/hooks/use-json";

export const ONDO_CLOSED_TIP =
  "Ondo tokens can only be sold while the US market is open. Outside those hours Ondo asks for a signed order, which Tally can't send yet. Try again when the market reopens.";

/** The reason Ondo selling is shut right now, or null (open, not an Ondo token, or unknown). */
export function useOndoClosedReason(ticker: string, issuer: string): string | null {
  const { data } = useJson<QuoteDto>(
    issuer === "ondo" ? `/api/quote?ticker=${encodeURIComponent(ticker)}&usd=25` : null,
    { refreshMs: 60_000 },
  );
  const row = data?.rows.find((r) => r.issuer === "ondo");
  return row && !row.executable && /signed order/i.test(row.notExecutableReason ?? "")
    ? ONDO_CLOSED_TIP
    : null;
}

/** Render-prop form, for rows that sit inside a loop where a hook cannot be called. */
export function OndoGate({
  ticker,
  issuer,
  children,
}: {
  ticker: string;
  issuer: string;
  children: (closedReason: string | null) => ReactNode;
}) {
  return <>{children(useOndoClosedReason(ticker, issuer))}</>;
}
