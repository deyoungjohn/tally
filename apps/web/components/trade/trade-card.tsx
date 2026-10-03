"use client";

import { ArrowDown, Lock } from "lucide-react";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Button } from "@/components/motion/button";
import { Segmented } from "@/components/motion/segmented";
import { ActionLabel } from "./flow-host";
import type { RowDto } from "@/lib/dto";
import { ISSUER_LABEL, fmtPct, fmtShares, fmtUsd } from "@/lib/format";
import { TokenLogo } from "./badges";

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
  let icon = false;
  if (!p.buyable) label = "Quotes only for now";
  else if (p.phaseLabel) label = p.phaseLabel;
  else if (p.busy) label = "Working…";
  else if (!p.row?.executable) label = "Not available";
  else if (tooSmall) label = `Minimum is $${MIN_USD}`;
  else if (!p.authenticated) {
    label = "Sign in to buy";
    icon = true;
  } else label = `Buy ${fmtUsd(p.spendUsd)} of ${p.ticker}`;

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
                <span className="text-[clamp(36px,5vw,56px)] font-bold leading-none text-fg3">
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
            className="mt-2 min-h-[20px] text-[13px] text-red"
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
              className="t-big min-w-0 !text-[clamp(30px,3.6vw,46px)]"
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
                  <span className="text-[11px] font-medium text-fg3">
                    via {ISSUER_LABEL[p.row.issuer]}
                  </span>
                ) : null}
              </span>
            </span>
          </div>
        </div>
      </div>

      <dl className="mt-3" data-testid="details">
        <div className="detail-row">
          <dt>Price per share</dt>
          <dd>{fmtUsd(p.row?.usdPerShare)}</dd>
        </div>
        <div className="detail-row">
          <dt>vs US price</dt>
          <dd>{fmtPct(p.row?.premium)}</dd>
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
          <dt>At least (guaranteed)</dt>
          <dd data-testid="min-received">
            {minShares === undefined ? "–" : `${fmtShares(minShares)} shares`}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="t-meta" id="tol-label">
          Price can move up to
        </span>
        <Segmented
          label="Price tolerance"
          value={String(p.tolerance)}
          onChange={(v) => p.onTolerance(Number(v))}
          options={TOLERANCES.map((t) => ({ value: String(t), label: `${t}%` }))}
        />
      </div>

      <div className="mt-5">
        <Button
          big
          disabled={!canBuy || (!p.authenticated ? !p.walletReady : false)}
          onClick={p.onBuy}
          data-testid="buy-button"
        >
          {icon ? <Lock size={18} aria-hidden /> : null}
          <ActionLabel text={label} />
        </Button>
        <p className="t-meta mt-3 text-center">
          If you&apos;d get fewer shares than the minimum above, the trade doesn&apos;t happen. Not
          investment advice.
        </p>
      </div>
    </section>
  );
}
