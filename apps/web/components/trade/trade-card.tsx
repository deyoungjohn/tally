"use client";

import { ArrowDown } from "lucide-react";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Button } from "@/components/motion/button";
import { Segmented } from "@/components/motion/segmented";
import { ActionLabel } from "./flow-host";
import type { RowDto } from "@/lib/dto";
import { ISSUER_LABEL, fmtShares, fmtUsd } from "@/lib/format";
import { TokenLogo } from "./badges";
import { LivePct, LiveUsd } from "@/components/motion/live";
import { LearnMore } from "@/components/learn-more";
import { Tip } from "@/components/ui/tooltip";

export type Unit = "usd" | "shares";
export const TOLERANCES = [0.5, 1, 2] as const;
export const MIN_USD = 6;

export interface TradeCardProps {
  ticker: string;
  unit: Unit;
  onUnit: (u: Unit) => void;
  amountText: string;
  onAmount: (s: string) => void;
  row: RowDto | undefined;
  /** USDT the buy will spend. */
  spendUsd: number | null;
  tolerance: number;
  onTolerance: (t: number) => void;
  buyable: boolean;
  authenticated: boolean;
  walletReady: boolean;
  busy: boolean;
  /** The transaction state in words (approve, confirm, buying…), shown on the button once signed in and a buy is under way. */
  phaseLabel?: string;
  quoteLoading: boolean;
  onBuy: () => void;
}

export function TradeCard(p: TradeCardProps) {
  const amount = Number(p.amountText);
  const tooSmall = p.unit === "usd" && p.amountText !== "" && amount < MIN_USD;
  const minShares =
    p.row?.shares === undefined ? undefined : p.row.shares * (1 - p.tolerance / 100);
  const canBuy =
    p.buyable && p.row?.executable && p.spendUsd !== null && p.spendUsd >= MIN_USD && !p.busy;

  let label: string;
  if (!p.buyable) label = "Quotes only for now";
  else if (p.phaseLabel) label = p.phaseLabel;
  else if (p.busy) label = "Working…";
  else if (!p.row?.executable) label = "Not available";
  else if (tooSmall) label = `Minimum is $${MIN_USD}`;
  else label = `Buy ${fmtUsd(p.spendUsd)} of ${p.ticker}`; // same words before and after sign-in; sign-in happens when it is pressed

  return (
    <section className="glass p-4 min-[561px]:p-6" aria-label="Trade card" data-testid="trade-card">
      <div className="flex items-center justify-between gap-3">
        <Segmented
          label="Amount unit"
          value={p.unit}
          onChange={(u) => {
            p.onUnit(u);
            p.onAmount(u === "usd" ? String(MIN_USD) : "");
          }}
          options={[
            { value: "usd", label: "$" },
            { value: "shares", label: "Shares" },
          ]}
        />
        <span className="limit-chip">Min ${MIN_USD}</span>
      </div>

      <div className="relative mt-4">
        <div className="field">
          <label htmlFor="amount" className="t-meta">
            {p.unit === "usd" ? "You pay" : "Shares you want"}
          </label>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {p.unit === "usd" ? (
                <span className="text-[clamp(37px,5vw,57px)] font-bold leading-none text-fg3">
                  $
                </span>
              ) : null}
              <input
                id="amount"
                className="amount-input"
                inputMode="decimal"
                autoComplete="off"
                placeholder={p.unit === "usd" ? "6" : "0.025"}
                value={p.amountText}
                aria-invalid={tooSmall}
                aria-describedby="amount-hint"
                onChange={(e) => {
                  const v = e.target.value.replace(",", ".");
                  if (/^\d*\.?\d{0,8}$/.test(v)) p.onAmount(v);
                }}
              />
            </div>
            <span className="token-pill">
              <TokenLogo ticker={p.unit === "usd" ? "USDT" : p.ticker} />
              {p.unit === "usd" ? "USDT" : p.ticker}
            </span>
          </div>
          <p
            id="amount-hint"
            className="mt-2 min-h-[20px] text-[14px] text-red"
            role={tooSmall ? "alert" : undefined}
          >
            {tooSmall ? `Minimum is $${MIN_USD}.` : ""}
          </p>
        </div>

        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 z-10 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[var(--edge)] bg-[var(--g3)]"
        >
          <ArrowDown size={16} />
        </span>

        <div className="field mt-2">
          <p className="t-meta">{p.unit === "usd" ? "You get" : "You pay about"}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p
              className="t-big min-w-0 !text-[clamp(31px,3.6vw,47px)]"
              data-testid="you-get"
              aria-busy={p.quoteLoading}
            >
              {p.unit === "usd" ? (
                p.row?.shares === undefined ? (
                  <span className="text-fg-disabled">–</span>
                ) : (
                  <AnimatedNumber
                    value={p.row.shares}
                    decimals={p.row.shares >= 1 ? 4 : 6}
                    startOnView={false}
                    duration={0.5}
                  />
                )
              ) : p.spendUsd === null ? (
                <span className="text-fg-disabled">–</span>
              ) : (
                <>
                  <span className="text-fg3">$</span>
                  <AnimatedNumber
                    value={p.spendUsd}
                    decimals={2}
                    startOnView={false}
                    duration={0.5}
                  />
                </>
              )}
            </p>
            <span className="token-pill">
              <TokenLogo ticker={p.ticker} />
              <span className="flex flex-col items-start leading-tight">
                <span>{p.unit === "usd" ? `${p.ticker} shares` : "USDT"}</span>
                {p.row ? (
                  <span className="text-[12px] font-medium text-fg3">
                    via {ISSUER_LABEL[p.row.issuer]}
                  </span>
                ) : null}
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="t-meta" id="tol-label">
          <Tip text="How much worse than the quote you accept before the trade is cancelled.">
            Slippage
          </Tip>
        </span>
        <Segmented
          label="Slippage"
          value={String(p.tolerance)}
          onChange={(v) => p.onTolerance(Number(v))}
          options={TOLERANCES.map((t) => ({ value: String(t), label: `${t}%` }))}
        />
      </div>

      <div className="mt-3">
        <Button
          big
          disabled={!canBuy || (!p.authenticated ? !p.walletReady : false)}
          onClick={p.onBuy}
          className="trade-cta"
          data-testid="buy-button"
        >
          <ActionLabel text={label} />
        </Button>
      </div>

      <dl className="mt-4" data-testid="details">
        <div className="detail-row">
          <dt>Price per share</dt>
          <dd>
            <LiveUsd value={p.row?.usdPerShare} />
          </dd>
        </div>
        <div className="detail-row">
          <dt>vs US price</dt>
          <dd>
            <LivePct value={p.row?.premium} />
          </dd>
        </div>
        <div className="detail-row">
          <dt>Network fee (estimated)</dt>
          <dd>{p.row?.feeUsd === undefined ? "–" : `≈ ${fmtUsd(p.row.feeUsd, 3)}`}</dd>
        </div>
        <div className="detail-row">
          <dt>Route</dt>
          <dd className="max-w-[60%]">{p.row?.routeText ?? "–"}</dd>
        </div>
        <div className="detail-row">
          <dt>
            <Tip text="The fewest shares you can receive. If the trade would give you less, it is cancelled on-chain.">
              Min amount to receive
            </Tip>
          </dt>
          <dd data-testid="min-received">
            {minShares === undefined ? "–" : `${fmtShares(minShares)} shares`}
          </dd>
        </div>
      </dl>

      <p className="t-meta mt-3 text-center">
        If you&apos;d get fewer shares than the minimum above, the trade doesn&apos;t happen. Not
        investment advice. <LearnMore concept="guarantee" />
      </p>
    </section>
  );
}
