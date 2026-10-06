"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { MIN_SELL_USDT } from "@tally/config";
import { Button } from "@/components/motion/button";
import { TokenLogo } from "@/components/trade/badges";
import type { SellTarget } from "@/components/trade/use-sell-flow";
import { Tip } from "@/components/ui/tooltip";
import { ISSUER_LABEL } from "@/lib/format";
import { nameOf } from "@/lib/tickers";
import type {
  HeadlineHoldingVM,
  IssuerHoldingVM,
  PortfolioVM,
} from "@/modules/statement/view-model";
import { sharesStr, usd } from "./vm-shared";

const pnlClass = (s: string) =>
  s.startsWith("-") ? "text-red" : s === "0.00" || s === "-" ? "text-fg2" : "text-up";

function IssuerRow({
  h,
  ticker,
  onSell,
}: {
  h: IssuerHoldingVM;
  ticker: string;
  onSell?: (t: SellTarget) => void;
}) {
  const sharesKnown = h.balanceShares !== "unavailable";
  const worth = Number.parseFloat(h.valueUsd);
  const sellable =
    !!onSell &&
    (h.rowActionsSlot.issuer === "ondo" || h.rowActionsSlot.issuer === "bstock") &&
    sharesKnown;
  const tooSmall = Number.isFinite(worth) && worth < MIN_SELL_USDT;
  // The view model's own row-action metadata says what a row action acts on (token, issuer, balance, ticker).
  const action = h.rowActionsSlot;
  const open = () =>
    onSell?.({
      ticker: action.ticker ?? ticker,
      issuer: action.issuer as "ondo" | "bstock",
      symbol: h.tokenSymbol,
      // The opening check only: the sale sheet requests the exact raw balance, never these display numbers.
      probeShares: Number.parseFloat(action.balanceShares ?? "0"),
      probeUsd: Number.isFinite(worth) ? worth : null,
    });
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[14px] bg-white/[0.03] px-3 py-2 text-[14.5px]"
      data-testid={`vm-issuer-${h.tokenSymbol}`}
    >
      <span className="flex items-center gap-2">
        <span
          className="text-[16px] font-bold text-fg"
          data-testid={`holding-symbol-${h.tokenSymbol}`}
        >
          {h.tokenSymbol}
        </span>
        <span
          className="text-[12.5px] font-light text-fg3"
          data-testid={`holding-issuer-${h.tokenSymbol}`}
        >
          {h.issuer ? ISSUER_LABEL[h.issuer] : "Unknown issuer"}
        </span>
      </span>
      <span className="num text-fg2">
        {h.balanceTokens} tokens ×{" "}
        {h.multiplier === "unavailable" ? (
          <Tip text="The share multiplier for this token couldn't be read, so its shares aren't counted. Tally never guesses 1:1.">
            <span className="text-amber">unknown</span>
          </Tip>
        ) : (
          h.multiplier
        )}{" "}
        = <b className="text-fg">{sharesStr(h.balanceShares)}</b>
        {sharesKnown ? "" : " shares"}
      </span>
      <span className="num text-fg2" data-testid={`vm-value-${h.tokenSymbol}`}>
        {usd(h.valueUsd)}
      </span>
      {h.convertedAtTodaysRatio ? (
        <span className="t-meta w-full">Converted at today&apos;s share ratio.</span>
      ) : null}
      {sellable ? (
        tooSmall ? (
          <Tip
            text={`This holding is worth ${usd(h.valueUsd)}, below the $${MIN_SELL_USDT} minimum sale.`}
          >
            <span className="inline-flex">
              <Button
                variant="glassy"
                className="!h-9 !px-4 text-[14.5px]"
                disabled
                aria-label={`Sell ${h.tokenSymbol} (below the $${MIN_SELL_USDT} minimum sale)`}
                data-testid={`sell-${h.tokenSymbol}`}
              >
                Sell
              </Button>
            </span>
          </Tip>
        ) : (
          <Button
            variant="glassy"
            className="!h-9 !px-4 text-[14.5px]"
            onClick={open}
            aria-label={`Sell ${h.tokenSymbol}`}
            data-testid={`sell-${h.tokenSymbol}`}
          >
            Sell
          </Button>
        )
      ) : null}
    </li>
  );
}

function Group({ g, onSell }: { g: HeadlineHoldingVM; onSell?: (t: SellTarget) => void }) {
  const known = g.issuers.some((i) => i.balanceShares !== "unavailable");
  return (
    <li className="panel list-none p-5" data-testid={`group-${g.ticker}`}>
      <div className="flex items-center gap-3">
        <TokenLogo ticker={g.ticker} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{nameOf(g.ticker)}</p>
          <p className="t-meta mono">{g.issuers.map((i) => i.tokenSymbol).join(" · ")}</p>
        </div>
        <div className="text-right">
          <p
            className="num text-[23px] font-bold tracking-tight"
            data-testid={`vm-total-shares-${g.ticker}`}
          >
            {known ? sharesStr(g.totalShares) : "unknown"}
          </p>
          <p className="t-meta">shares · ≈ {usd(g.totalValueUsd)}</p>
        </div>
      </div>
      <dl className="mt-3">
        <div className="detail-row">
          <dt>Average cost per share</dt>
          <dd>{usd(g.avgCostPerShareUsd)}</dd>
        </div>
        <div className="detail-row">
          <dt>Unrealized gain or loss</dt>
          <dd className={pnlClass(g.unrealizedPnlUsd)}>
            {usd(g.unrealizedPnlUsd)}
            {g.avgCostPerShareUsd === "-" ? "" : ` (${g.unrealizedPnlPercent}%)`}
          </dd>
        </div>
      </dl>
      <ul className="m-0 mt-3 grid list-none gap-2 p-0">
        {g.issuers.map((h) => (
          <IssuerRow key={h.tokenSymbol} h={h} ticker={g.ticker} onSell={onSell} />
        ))}
      </ul>
      <Link
        href={`/trade/${g.ticker}`}
        className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-[14px] text-blue"
      >
        Buy more {nameOf(g.ticker)} <ArrowRight size={13} aria-hidden />
      </Link>
    </li>
  );
}

export function HoldingsVm({ vm, onSell }: { vm: PortfolioVM; onSell?: (t: SellTarget) => void }) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0" data-testid="vm-holdings">
      {vm.holdings.map((g) => (
        <Group key={g.ticker} g={g} onSell={onSell} />
      ))}
    </ul>
  );
}
