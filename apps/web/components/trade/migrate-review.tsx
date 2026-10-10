"use client";
// The first thing Migrate shows: what you sell, what you receive, the costs and what you end up with. Nothing is sent until
// Confirm; Confirm then sells the whole holding by itself (see `useMigrateFlow`), and the buy has its own review next.
// Every number comes from the sale's own plan and a live quote of the target; none is recomputed from a displayed float.

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/motion/button";
import { Modal } from "@/components/motion/modal";
import { useTallyWallet } from "@/components/wallet/wallet-context";
import type { QuoteDto } from "@/lib/dto";
import { fmtUsd } from "@/lib/format";
import { toSellSheet, fromE18, type SellSheetView } from "@/lib/sell/view";
import { explainSellError } from "@/lib/sell/view";
import { fetchSellPlan } from "@/lib/trade-plan/sell";
import { tokenSymbol } from "@/lib/tickers";
import { MIN_ORDER_USDT } from "@tally/config";
import type { MigrateReview } from "./use-migrate-flow";

interface Loaded {
  sell: SellSheetView;
  usdtOut: number;
  buy: { shares: number; usdPerShare: number; feeUsd: number | null } | null;
  buyReason: string | null;
}

type State =
  { name: "loading" } | { name: "error"; message: string } | { name: "ready"; v: Loaded };

export function MigrateReviewModal({
  review,
  onConfirm,
  onClose,
}: {
  review: MigrateReview | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const wallet = useTallyWallet();
  const [state, setState] = useState<State>({ name: "loading" });
  const address = wallet.address;

  useEffect(() => {
    if (!review) return;
    let live = true;
    setState({ name: "loading" });
    (async () => {
      try {
        if (!address) throw new Error("Sign in to migrate.");
        const t = review.target;
        const probe = Math.floor(t.probeShares * 1e8) / 1e8;
        const plan = await fetchSellPlan({
          ticker: t.ticker,
          issuer: t.issuer,
          shares: probe > 0 ? probe : undefined,
          tokens: probe > 0 ? undefined : "1",
          tolerancePct: 1,
          user: address,
        });
        const sell = toSellSheet(plan);
        const usdtOut = Number(BigInt(sell.expectedUsdt)) / 1e18;
        // What the buy would look like with the proceeds, rounded down to the cent like the real buy.
        const usd = Math.floor(usdtOut * 100) / 100;
        let buy: Loaded["buy"] = null;
        let buyReason: string | null = null;
        if (usd < MIN_ORDER_USDT) {
          buyReason = `The proceeds are below the ${MIN_ORDER_USDT} USDT minimum for a buy.`;
        } else {
          try {
            const res = await fetch(
              `/api/quote?ticker=${encodeURIComponent(t.ticker)}&usd=${usd}`,
              {
                cache: "no-store",
              },
            );
            const q = (await res.json()) as QuoteDto;
            const row = res.ok ? q.rows.find((r) => r.issuer === review.to) : undefined;
            if (row?.executable && row.shares !== undefined && row.usdPerShare !== undefined)
              buy = {
                shares: row.shares,
                usdPerShare: row.usdPerShare,
                feeUsd: row.feeUsd ?? null,
              };
            else
              buyReason = row?.notExecutableReason ?? "The target token can't be bought right now.";
          } catch {
            buyReason = "The target's price couldn't be read right now.";
          }
        }
        if (live) setState({ name: "ready", v: { sell, usdtOut, buy, buyReason } });
      } catch (e) {
        if (live)
          setState({
            name: "error",
            message:
              e instanceof Error && /sign in/i.test(e.message)
                ? e.message
                : explainSellError(e).message,
          });
      }
    })();
    return () => {
      live = false;
    };
  }, [review, address]);

  const to = review ? tokenSymbol(review.target.ticker, review.to) : "";
  const from = review?.target.symbol ?? "";
  const v = state.name === "ready" ? state.v : null;
  const canConfirm = !!v && v.sell.status !== "needs_funds" && !!v.buy;
  const fees = v ? (v.sell.feeUsd ?? 0) + (v.buy?.feeUsd ?? 0) : 0;

  return (
    <Modal
      open={review !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Migrate ${from} to ${to}`}
      description="Migrate involves a sale and a purchase and you'll confirm each one."
      className="max-w-[540px]"
      showClose
    >
      <div className="mt-4" data-testid="migrate-review">
        {state.name === "loading" ? (
          <p className="flex items-center gap-2 text-fg2" aria-busy="true">
            <Loader2 size={16} className="animate-spin" aria-hidden /> Getting prices for both
            steps…
          </p>
        ) : state.name === "error" ? (
          <p role="alert" className="text-amber" data-testid="migrate-review-error">
            {state.message}
          </p>
        ) : v ? (
          <dl className="m-0">
            <div className="detail-row">
              <dt>Step 1 · you sell</dt>
              <dd data-testid="mr-sell">
                {fromE18(v.sell.sharesIn, 6)} shares ({fromE18(v.sell.tokensIn, 8)} {from})
              </dd>
            </div>
            <div className="detail-row">
              <dt>You receive (USDT)</dt>
              <dd data-testid="mr-usdt">
                about {fromE18(v.sell.expectedUsdt, 2)}, at least {fromE18(v.sell.minUsdt, 2)}
              </dd>
            </div>
            <div className="detail-row">
              <dt>Network fee, sale</dt>
              <dd>{v.sell.feeUsd === null ? "-" : `≈ ${fmtUsd(v.sell.feeUsd, 3)}`}</dd>
            </div>
            <div className="detail-row">
              <dt>Step 2 · you buy</dt>
              <dd data-testid="mr-buy">
                {v.buy
                  ? `about ${v.buy.shares.toFixed(6)} shares of ${to} at ${fmtUsd(v.buy.usdPerShare)}`
                  : "-"}
              </dd>
            </div>
            <div className="detail-row">
              <dt>Network fee, buy</dt>
              <dd>
                {v.buy?.feeUsd === undefined || v.buy?.feeUsd === null
                  ? "-"
                  : `≈ ${fmtUsd(v.buy.feeUsd, 3)}`}
              </dd>
            </div>
            <div className="detail-row">
              <dt>Network fees in total</dt>
              <dd data-testid="mr-fees">≈ {fmtUsd(fees, 3)}</dd>
            </div>
          </dl>
        ) : null}

        {v?.sell.status === "needs_approval" ? (
          <p className="t-meta mt-3">
            The sale starts with a one-time approval for exactly this amount of {from}.
          </p>
        ) : null}
        {v?.sell.status === "needs_funds" ? (
          <p role="alert" className="mt-3 text-amber">
            This wallet doesn&apos;t have enough {from} or BNB for the network fee to sell this
            amount.
          </p>
        ) : null}
        {v?.buyReason ? (
          <p role="alert" className="mt-3 text-amber" data-testid="migrate-review-buy-reason">
            {v.buyReason}
          </p>
        ) : null}
        <p className="t-meta mt-3">
          Prices can move between the two steps. Confirming sells your whole {from} holding for
          USDT; the buy then has its own review before anything is bought.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="glassy" onClick={onClose}>
            Cancel
          </Button>
          {state.name === "error" ? null : (
            <Button onClick={onConfirm} disabled={!canConfirm} data-testid="migrate-review-confirm">
              Confirm
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Shown while the sale runs by itself after Confirm: which step it is on, with a way out until the wallet is asked to sign. */
export function MigrateSellProgress({
  phaseName,
  approving,
  symbol,
  onCancel,
}: {
  phaseName: string;
  approving: "sign" | "mining" | null;
  symbol: string;
  onCancel: () => void;
}) {
  const text =
    phaseName === "approve"
      ? approving === "mining"
        ? `Approving ${symbol}…`
        : `Approve selling ${symbol} in your wallet`
      : phaseName === "signing"
        ? "Confirm the sale in your wallet"
        : phaseName === "mining"
          ? "Selling… waiting for the chain to confirm"
          : "Preparing the sale…";
  const cancellable = phaseName !== "signing" && phaseName !== "mining";
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o && cancellable) onCancel();
      }}
      title={`Selling ${symbol}`}
      description="Step 1 of 2. Your whole holding is being sold for USDT."
      className="max-w-[460px]"
    >
      <p
        className="mt-4 flex items-center gap-2 text-fg2"
        aria-live="polite"
        data-testid="migrate-sell-progress"
      >
        <Loader2 size={16} className="animate-spin" aria-hidden /> {text}
      </p>
      {cancellable ? (
        <div className="mt-5 flex justify-end">
          <Button variant="glassy" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}

/** Asked whenever someone leaves a Migrate that is under way: the saved Migrate is removed for good if they confirm. */
export function MigrateDropConfirm({
  open,
  onKeep,
  onDrop,
}: {
  open: boolean;
  onKeep: () => void;
  onDrop: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) onKeep();
      }}
      title="Drop this Migrate?"
      description="Your Migrate will be dropped permanently."
      className="max-w-[460px]"
    >
      <div className="mt-4 grid gap-2 text-fg2" data-testid="migrate-drop-confirm">
        <p>
          If you leave now, this Migrate is dropped permanently: Tally forgets it and you can&apos;t
          pick it up again.
        </p>
        <p>
          Anything already confirmed on the chain stays as it is. If your sale went through, your
          USDT is in your wallet and nothing will be bought.
        </p>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <Button variant="glassy" onClick={onDrop} data-testid="migrate-drop">
          Drop Migrate
        </Button>
        <Button onClick={onKeep} data-testid="migrate-keep-going" autoFocus>
          Keep going
        </Button>
      </div>
    </Modal>
  );
}
