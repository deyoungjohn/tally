"use client";
// "Suggested for you" under the holdings. The cards come only from `PortfolioVM.suggestions`: nothing is computed here.

import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/motion/button";
import { LiquidityBadge } from "@/components/trade/badges";
import { TokenIcon } from "@/components/ui/token-icon";
import type { PortfolioSuggestionsVM } from "@/modules/statement/view-model";

export function SuggestionsBlock({
  suggestions,
}: {
  suggestions: PortfolioSuggestionsVM | null | undefined;
}) {
  if (!suggestions || suggestions.state === "none_needed") return null;
  if (suggestions.state === "unavailable")
    return (
      <p className="t-meta mt-4" data-testid="suggestions-unavailable">
        Suggestions: {suggestions.reasonText}
      </p>
    );
  if (suggestions.items.length === 0) return null;
  return (
    <section className="mt-6" aria-labelledby="suggested-title" data-testid="suggestions">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="suggested-title" className="t-h3">
          Suggested for you
        </h2>
        {suggestions.fixture ? (
          <span className="t-meta text-amber" data-testid="suggestions-fixture">
            Fixture data
          </span>
        ) : null}
      </div>
      <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-3 p-0 min-[761px]:grid-cols-3">
        {suggestions.items.map((item) => (
          <li
            key={item.symbol}
            className="panel flex min-w-0 flex-col gap-3 p-4"
            data-testid={`suggestion-${item.symbol}`}
          >
            <div className="flex items-center gap-3">
              <TokenIcon ticker={item.ticker} size={32} />
              <div className="min-w-0 flex-1">
                <p className="mono text-[17px] font-bold leading-tight">{item.symbol}</p>
                <p className="truncate text-[14px] text-fg2">{item.name}</p>
              </div>
              <LiquidityBadge grade={item.grade} />
            </div>
            <p className="t-meta flex-1">{item.reason}</p>
            <ButtonLink
              href={`/trade/${item.ticker}?issuer=${item.issuer}`}
              data-testid={`suggestion-buy-${item.symbol}`}
              aria-label={`Buy ${item.symbol}`}
            >
              Buy <ArrowRight size={16} aria-hidden />
            </ButtonLink>
          </li>
        ))}
      </ul>
      <SuggestionsDisclaimer />
    </section>
  );
}

/** Shown under recommendations wherever they appear (Portfolio, Guardian) and only when there are some. */
export function SuggestionsDisclaimer() {
  return (
    <p
      className="mt-3 max-w-[70ch] text-[13px] leading-5 text-fg3"
      data-testid="suggestions-disclaimer"
    >
      Token recommendations are not investment advice. We recommend tokens with good liquidity and
      we don&apos;t guarantee profits when you buy tokens based on our recommendations.
    </p>
  );
}
