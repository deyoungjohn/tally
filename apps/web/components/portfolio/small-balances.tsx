"use client";
// Token balances worth less than $1 are left out of the holdings by default. A small link opens them in a dialog, so nothing
// is hidden for good. (The "Other assets" panel has no such link: below $1 it is simply not shown.)

import { useState } from "react";
import { Modal } from "@/components/motion/modal";
import { ISSUER_LABEL } from "@/lib/format";
import { companyName } from "./company-name";

export const SMALL_BALANCE_USD = 1;

/** A balance with a known value under the threshold. An unknown value is never called small. */
export const isSmallUsd = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value < SMALL_BALANCE_USD;

/** Which of the wallet's other assets are shown: anything worth under $1 is left out, with no way to show it. An unknown BNB price hides nothing. */
export function otherAssetsShown(
  wallet: { usdt: number; bnb: number },
  bnbUsd: number | null | undefined,
) {
  return {
    usdt: !isSmallUsd(wallet.usdt),
    bnb: typeof bnbUsd !== "number" || !isSmallUsd(wallet.bnb * bnbUsd),
  };
}

export interface SmallBalance {
  key: string;
  symbol: string;
  ticker: string;
  issuer: "ondo" | "bstock" | "xstocks";
  shares: string;
  valueUsd: string;
}

export function SmallBalancesLink({ items }: { items: SmallBalance[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="show-small-balances"
        className="mt-3 inline-flex min-h-[44px] items-center text-[14px] link-text"
      >
        Show small token balances
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Small token balances"
        description={`Balances worth less than $${SMALL_BALANCE_USD}, left out of your holdings.`}
        showClose
      >
        <ul className="m-0 mt-4 grid max-h-[min(60vh,420px)] list-none gap-2 overflow-y-auto p-0">
          {items.map((i) => (
            <li
              key={i.key}
              className="panel flex items-center justify-between gap-3 p-3"
              data-testid={`small-balance-${i.symbol}`}
            >
              <span className="min-w-0">
                <span className="mono block text-[16px] font-bold">{i.symbol}</span>
                <span className="block text-[13px] font-light text-fg2">
                  {companyName(i.ticker)} · {ISSUER_LABEL[i.issuer]}
                </span>
              </span>
              <span className="text-right">
                <span className="num block font-semibold">{i.shares}</span>
                <span className="t-meta">shares · ≈ ${i.valueUsd}</span>
              </span>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
