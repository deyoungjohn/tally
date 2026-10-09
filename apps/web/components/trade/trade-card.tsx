"use client";

import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { PercentSlider } from "@/components/ui/percent-slider";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Button } from "@/components/motion/button";
import { Segmented } from "@/components/motion/segmented";
import { ActionLabel } from "./flow-host";
import type { RowDto } from "@/lib/dto";
import { MIN_SELL_USDT } from "@tally/config";
import { tokenPair } from "@/lib/tickers";
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
  /** The flip button swaps buying and selling. Selling stays unavailable (the button is disabled) until the server turns it on. */
  mode?: "buy" | "sell";
  onFlip?: () => void;
  flipEnabled?: boolean;
  /** USDT in the signed-in wallet, for the buy slider. */
  usdtBalance?: number | null;
  /** Sell mode: what the wallet holds of this stock and what pressing the button does. */
  sell?: {
    text: string;
    onText: (s: string) => void;
    heldShares: number;
    /** The token count of the same holding, for the slider (a token is not exactly a share). */
    heldTokens?: number;
    /** The token symbol being sold (NVDAB, NVDAon). */
    symbol?: string;
    usdOut: number | null;
    onSell: () => void;
  };
}

/** A token count, up to six places, no trailing zeros. */
const fmtTokenCount = (n: number) => String(Number(n.toFixed(6)));

const floorTo = (n: number, places: number) => {
  const f = 10 ** places;
  return Math.floor(n * f) / f;
};

export function TradeCard(p: TradeCardProps) {
  const amount = Number(p.amountText);
  const tooSmall = p.unit === "usd" && p.amountText !== "" && amount < MIN_USD;
  const minShares =
    p.row?.shares === undefined ? undefined : p.row.shares * (1 - p.tolerance / 100);
  const canBuy =
    p.buyable && p.row?.executable && p.spendUsd !== null && p.spendUsd >= MIN_USD && !p.busy;

  const selling = p.mode === "sell" && p.sell !== undefined;
  // The token symbol shown wherever the card names what is bought or sold (never a bare ticker).
  const sym = (selling ? p.sell?.symbol : p.row?.symbol) ?? tokenPair(p.ticker);
  const sellShares = p.sell && /^\d*\.?\d*$/.test(p.sell.text) ? Number(p.sell.text) : 0;
  // Below the smallest sale the router path accepts: the button is unclickable, so no sheet has to open just to say so.
  const belowMinSale =
    selling && sellShares > 0 && p.sell!.usdOut !== null && p.sell!.usdOut < MIN_SELL_USDT;
  const canSell =
    selling &&
    !belowMinSale &&
    p.sell!.heldShares > 0 &&
    sellShares > 0 &&
    sellShares <= p.sell!.heldShares + 1e-9 &&
    !p.busy;

  // Buy slider: a share of the wallet's USDT. In dollars it sets the amount directly; in shares it converts at the best price.
  const spendNow = p.unit === "usd" ? (amount > 0 ? amount : 0) : (p.spendUsd ?? 0);
  const buyPercent =
    p.usdtBalance && p.usdtBalance > 0 ? Math.min(100, (spendNow / p.usdtBalance) * 100) : 0;
  const onBuyPercent = (pct: number) => {
    if (!p.usdtBalance) return;
    const usd = floorTo((p.usdtBalance * pct) / 100, 2);
    if (p.unit === "usd") p.onAmount(usd > 0 ? String(usd) : "");
    else if (p.row?.usdPerShare)
      p.onAmount(usd > 0 ? String(floorTo(usd / p.row.usdPerShare, 6)) : "");
  };
  const sellPercent =
    p.sell && p.sell.heldShares > 0 ? Math.min(100, (sellShares / p.sell.heldShares) * 100) : 0;
  const onSellPercent = (pct: number) => {
    if (!p.sell) return;
    // 100% is the whole holding exactly as shown; the sheet re-reads the exact balance when it opens.
    p.sell.onText(pct <= 0 ? "" : String(floorTo((p.sell.heldShares * pct) / 100, 8)));
  };

  let label: string;
  if (selling) label = belowMinSale ? `Minimum sale is $${MIN_SELL_USDT}` : `Sell ${sym}`;
  else if (!p.buyable) label = "Quotes only for now";
  else if (p.phaseLabel) label = p.phaseLabel;
  else if (p.busy) label = "Working…";
  else if (!p.row?.executable) label = "Not available";
  else if (tooSmall) label = `Minimum is $${MIN_USD}`;
  else label = p.row ? `Buy ${fmtUsd(p.spendUsd)} of ${p.row.symbol}` : `Buy ${fmtUsd(p.spendUsd)}`; // same words before and after sign-in; sign-in happens when it is pressed

  return (
    <section className="glass p-4 min-[561px]:p-6" aria-label="Trade card" data-testid="trade-card">
      <div className="flex items-center justify-between gap-3">
        {selling ? (
          <span className="t-meta" data-testid="mode-label">
            Selling · to USDT
          </span>
        ) : (
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
        )}
        {selling ? null : <span className="limit-chip">Min ${MIN_USD}</span>}
      </div>

      <div className="relative mt-4">
        <div className="field">
          <label htmlFor="amount" className="t-meta">
            {selling ? "You sell" : p.unit === "usd" ? "You pay" : "Shares you want"}
          </label>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {!selling && p.unit === "usd" ? (
                <span className="text-[clamp(37px,5vw,57px)] font-bold leading-none text-fg3">
                  $
                </span>
              ) : null}
              <input
                id="amount"
                className="amount-input"
                inputMode="decimal"
                autoComplete="off"
                placeholder={selling ? "0.025" : p.unit === "usd" ? "6" : "0.025"}
                value={selling ? p.sell!.text : p.amountText}
                onChange={() => {}}
                aria-invalid={selling ? sellShares > p.sell!.heldShares : tooSmall}
                aria-describedby="amount-hint"
                onInput={(e) => {
                  const v = e.currentTarget.value.replace(",", ".");
                  if (/^\d*\.?\d{0,8}$/.test(v)) (selling ? p.sell!.onText : p.onAmount)(v);
                }}
              />
            </div>
            <span className="token-pill">
              <TokenLogo ticker={selling || p.unit !== "usd" ? sym : "USDT"} />
              {selling || p.unit !== "usd" ? sym : "USDT"}
            </span>
          </div>
          <p
            id="amount-hint"
            className="mt-2 min-h-[20px] text-[14px] text-red"
            role={tooSmall || selling ? "alert" : undefined}
          >
            {selling
              ? p.sell!.heldShares <= 0
                ? `You don't hold any ${tokenPair(p.ticker)} to sell.`
                : sellShares > p.sell!.heldShares
                  ? `You only hold ${fmtShares(p.sell!.heldShares)} shares.`
                  : belowMinSale
                    ? `Minimum sale is $${MIN_SELL_USDT}.`
                    : ""
              : tooSmall
                ? `Minimum is $${MIN_USD}.`
                : ""}
          </p>
        </div>

        {/* A zero-height row in the gap between the two boxes: the button is centred on the gap in both modes, whatever the boxes hold. */}
        <div className="relative z-10 h-2" data-testid="flip-row">
          <button
            type="button"
            onClick={p.onFlip}
            disabled={!p.flipEnabled || p.busy}
            aria-label={
              !p.flipEnabled
                ? "Selling is not switched on yet"
                : selling
                  ? "Switch to buying"
                  : "Switch to selling"
            }
            title={!p.flipEnabled ? "Selling is not switched on yet" : undefined}
            data-testid="flip-button"
            className="absolute left-1/2 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[var(--edge)] bg-black/60 transition-colors hover:bg-[var(--hl)] enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArrowUpDown
              size={17}
              aria-hidden
              className={cn(
                "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                selling && "rotate-180",
              )}
            />
          </button>
        </div>
        <div className="field">
          <p className="t-meta">
            {selling ? "You get about" : p.unit === "usd" ? "You get" : "You pay about"}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p
              className="t-big min-w-0 !text-[clamp(31px,3.6vw,47px)]"
              data-testid="you-get"
              aria-busy={p.quoteLoading}
            >
              {selling ? (
                p.sell!.usdOut === null ? (
                  <span className="text-fg-disabled">–</span>
                ) : (
                  <>
                    <span className="text-fg3">$</span>
                    <AnimatedNumber
                      value={p.sell!.usdOut}
                      decimals={2}
                      startOnView={false}
                      duration={0.5}
                    />
                  </>
                )
              ) : p.unit === "usd" ? (
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
              <TokenLogo ticker={selling ? "USDT" : sym} />
              <span className="flex flex-col items-start leading-tight">
                <span>{selling ? "USDT" : p.unit === "usd" ? `${sym} shares` : "USDT"}</span>
                {p.row && !selling ? (
                  <span className="text-[12px] font-medium text-fg3">
                    via {ISSUER_LABEL[p.row.issuer]}
                  </span>
                ) : null}
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        {selling ? (
          <PercentSlider
            value={sellPercent}
            onChange={onSellPercent}
            label={`${sym} tokens`}
            available={
              p.sell!.heldShares > 0
                ? `${fmtTokenCount(p.sell!.heldTokens ?? p.sell!.heldShares)} tokens`
                : undefined
            }
            disabled={p.sell!.heldShares <= 0}
            testId="trade-slider"
          />
        ) : (
          <PercentSlider
            value={buyPercent}
            onChange={onBuyPercent}
            label="USDT"
            available={p.usdtBalance != null ? `${fmtUsd(p.usdtBalance)} USDT` : undefined}
            disabled={!p.authenticated || !p.usdtBalance || (p.unit === "shares" && !p.row)}
            testId="trade-slider"
          />
        )}
      </div>

      {selling ? null : (
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
      )}

      <div className="mt-3">
        <Button
          big
          disabled={
            selling
              ? !canSell && p.authenticated
              : !canBuy || (!p.authenticated ? !p.walletReady : false)
          }
          onClick={selling ? p.sell!.onSell : p.onBuy}
          className="trade-cta"
          data-testid={selling ? "sell-button" : "buy-button"}
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
        {selling ? null : (
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
        )}
      </dl>

      <p className="t-meta mt-3 text-center">
        {selling ? (
          "You confirm the exact quote, and the least USDT you receive, on the next screen. Not investment advice."
        ) : (
          <>
            If you&apos;d get fewer shares than the minimum above, the trade doesn&apos;t happen.
            Not investment advice. <LearnMore concept="guarantee" />
          </>
        )}
      </p>
    </section>
  );
}
