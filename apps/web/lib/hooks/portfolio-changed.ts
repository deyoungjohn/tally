"use client";
// One signal for "a transaction just finished": every portfolio view (holdings, activity, statement, balances) reads again at once
// instead of waiting for its next poll. Buys, sales and migrations call `notifyPortfolioChanged()` when they confirm; `useJson`
// listens for it on the portfolio URLs.

const listeners = new Set<() => void>();

/** URLs whose data a transaction can change. */
export const PORTFOLIO_URL =
  /^\/api\/(portfolio|holdings|vm\/(portfolio|activity|statement))(\?|$)/;

/** Tell every open portfolio view to read again now, and once more shortly after (the chain and the feeds settle a moment later). */
export function notifyPortfolioChanged(): void {
  const fire = () => listeners.forEach((l) => l());
  fire();
  if (typeof window !== "undefined") {
    window.setTimeout(fire, 3_000);
    window.setTimeout(fire, 10_000);
  }
}

export function onPortfolioChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
