"use client";
// The three buttons on every holding row, always in this order: Buy more, Migrate, Sell. Each one knows when it cannot be used and
// says why in a tooltip (a disabled button is never silent): a sale under $5, an Ondo token while the US market is closed, an issuer
// that is not enabled, xStocks (no market to exit). Buy more is a link while it works.

import { Button, ButtonLink } from "@/components/motion/button";
import { Tip } from "@/components/ui/tooltip";
import { useOndoClosedReason } from "@/components/trade/ondo-gate";
import { MIN_SELL_USDT } from "@tally/config";
import { fmtUsd } from "@/lib/format";
import { isTokenBuyable } from "@/lib/tickers";
import { canMigrateTicker } from "./enablement";

const SMALL = "!h-9 !px-4 text-[14.5px]";
const MIN_BUY_USDT = 6;

function Disabled({ label, reason, testId }: { label: string; reason: string; testId: string }) {
  return (
    <Tip text={reason}>
      <span className="inline-flex">
        <Button
          variant="glassy"
          className={SMALL}
          disabled
          aria-label={`${label} (unavailable): ${reason}`}
          data-testid={testId}
        >
          {label}
        </Button>
      </span>
    </Tip>
  );
}

export function RowActions({
  ticker,
  issuer,
  symbol,
  valueUsd,
  sharesKnown = true,
  onSell,
  onMigrate,
}: {
  ticker: string;
  issuer: string | null;
  symbol: string;
  /** What the holding is worth in dollars; null when unknown. */
  valueUsd: number | null;
  sharesKnown?: boolean;
  /** Present only when selling is switched on for this wallet. */
  onSell?: () => void;
  /** Present only when Migrate is switched on for this wallet. */
  onMigrate?: (to: "ondo" | "bstock") => void;
}) {
  const closed = useOndoClosedReason(ticker, issuer ?? "");
  const tradable = issuer === "ondo" || issuer === "bstock";
  const worth = valueUsd ?? Number.NaN;
  const worthText = Number.isFinite(worth) ? fmtUsd(worth) : "unknown";

  // Buy more
  let buyReason: string | null = null;
  if (!tradable) buyReason = "xStocks tokens can't be bought through Tally.";
  else if (!isTokenBuyable(ticker, issuer)) buyReason = `${symbol} isn't enabled for buying yet.`;
  else if (closed) buyReason = closed;

  // Sell
  let sellReason: string | null = null;
  if (!sharesKnown)
    sellReason = "The share multiplier for this token couldn't be read, so it can't be sold.";
  else if (closed) sellReason = closed;
  else if (Number.isFinite(worth) && worth < MIN_SELL_USDT)
    sellReason = `This holding is worth ${worthText}, below the $${MIN_SELL_USDT} minimum sale.`;

  // Migrate
  let migrateReason: string | null = null;
  if (!tradable) migrateReason = "There is no market to exit this token on BNB Chain.";
  else if (closed) migrateReason = closed;
  else if (!sharesKnown)
    migrateReason =
      "The share multiplier for this token couldn't be read, so it can't be migrated.";
  else if (Number.isFinite(worth) && worth < MIN_SELL_USDT)
    migrateReason = `This holding is worth ${worthText}, below the $${MIN_SELL_USDT} minimum sale.`;
  else if (Number.isFinite(worth) && worth < MIN_BUY_USDT)
    migrateReason = `The proceeds would be under the ${MIN_BUY_USDT} USDT minimum for the buy.`;

  return (
    <div className="flex flex-wrap gap-2" data-testid={`actions-${symbol}`}>
      {buyReason ? (
        <Disabled label="Buy more" reason={buyReason} testId={`buy-more-${symbol}`} />
      ) : (
        <ButtonLink
          href={`/trade/${ticker}`}
          variant="glassy"
          className={SMALL}
          data-testid={`buy-more-${symbol}`}
        >
          Buy more
        </ButtonLink>
      )}
      {onMigrate && canMigrateTicker(ticker) ? (
        migrateReason ? (
          <Disabled label="Migrate" reason={migrateReason} testId={`migrate-${symbol}`} />
        ) : (
          <Button
            variant="glassy"
            className={SMALL}
            onClick={() => onMigrate(issuer === "ondo" ? "bstock" : "ondo")}
            aria-label={`Migrate ${symbol}`}
            data-testid={`migrate-${symbol}`}
          >
            Migrate
          </Button>
        )
      ) : null}
      {onSell && tradable ? (
        sellReason ? (
          <Disabled label="Sell" reason={sellReason} testId={`sell-${symbol}`} />
        ) : (
          <Button
            variant="glassy"
            className={SMALL}
            onClick={onSell}
            aria-label={`Sell ${symbol}`}
            data-testid={`sell-${symbol}`}
          >
            Sell
          </Button>
        )
      ) : null}
    </div>
  );
}
