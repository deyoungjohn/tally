"use client";
// Tokens the wallet holds on chain that the statement feed does not list (its registry is a truncated list, so some
// tokens, Ondo ones included, can be missing there). Read straight from the chain through /api/portfolio, labelled as such.

import type { PortfolioReport } from "@tally/engine";
import { MIN_SELL_USDT } from "@tally/config";
import { Button } from "@/components/motion/button";
import { LiveShares, LiveUsd } from "@/components/motion/live";
import { Tip } from "@/components/ui/tooltip";
import { GradeBadge, TokenLogo } from "@/components/trade/badges";
import type { SellTarget } from "@/components/trade/use-sell-flow";
import { ISSUER_LABEL } from "@/lib/format";
import { companyName } from "./company-name";
import type { PortfolioVM } from "@/modules/statement/view-model";

type Part = PortfolioReport["groups"][number]["parts"][number];

/** Chain holdings whose token address is not among the view model's. */
export function chainOnlyParts(
  report: Pick<PortfolioReport, "groups"> | null,
  vm: PortfolioVM | null,
) {
  if (!report) return [];
  const known = new Set(
    (vm?.holdings ?? []).flatMap((g) => g.issuers.map((i) => i.tokenContractAddress.toLowerCase())),
  );
  return report.groups.flatMap((g) => g.parts).filter((p) => !known.has(p.address.toLowerCase()));
}

export function ChainOnlyHoldings({
  parts,
  onSell,
}: {
  parts: Part[];
  onSell?: (t: SellTarget) => void;
}) {
  if (parts.length === 0) return null;
  return (
    <section className="mt-4" aria-label="Also in your wallet" data-testid="chain-only-holdings">
      <h2 className="t-h3 !text-[19px]">Also in your wallet</h2>
      <p className="t-meta mt-1">
        Read from the chain: these tokens are not in the statement feed yet.
      </p>
      <ul className="m-0 mt-3 grid list-none gap-3 p-0">
        {parts.map((p) => {
          const tooSmall = p.valueUsd !== null && p.valueUsd < MIN_SELL_USDT;
          const canSell = onSell && p.issuer !== "xstocks";
          return (
            <li key={p.address} className="panel p-4" data-testid={`chain-only-${p.symbol}`}>
              <div className="flex flex-wrap items-center gap-3">
                <TokenLogo ticker={p.ticker} />
                <div className="min-w-0 flex-1">
                  <p className="mono flex items-center gap-2 text-[19px] font-bold leading-tight">
                    {p.symbol} <GradeBadge grade={p.grade} className="!h-6 !w-6 !text-[12px]" />
                  </p>
                  <p className="text-[13.5px] font-light text-fg2">
                    {companyName(p.ticker)} · {ISSUER_LABEL[p.issuer]}
                  </p>
                </div>
                <div className="text-right">
                  <LiveShares value={p.shares} className="num flex justify-end font-semibold" />
                  <p className="t-meta">
                    shares · ≈ <LiveUsd value={p.valueUsd} />
                  </p>
                </div>
              </div>
              {canSell ? (
                <div className="mt-3">
                  {tooSmall ? (
                    <Tip text={`Below the $${MIN_SELL_USDT} minimum sale.`}>
                      <span className="inline-flex">
                        <Button
                          variant="glassy"
                          className="!h-9 !px-4 text-[14.5px]"
                          disabled
                          aria-label={`Sell ${p.symbol} (below the minimum sale)`}
                        >
                          Sell
                        </Button>
                      </span>
                    </Tip>
                  ) : (
                    <Button
                      variant="glassy"
                      className="!h-9 !px-4 text-[14.5px]"
                      aria-label={`Sell ${p.symbol}`}
                      data-testid={`sell-${p.symbol}`}
                      onClick={() =>
                        onSell({
                          ticker: p.ticker,
                          issuer: p.issuer as "ondo" | "bstock",
                          symbol: p.symbol,
                          probeShares: p.shares,
                          probeUsd: p.valueUsd,
                        })
                      }
                    >
                      Sell
                    </Button>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
