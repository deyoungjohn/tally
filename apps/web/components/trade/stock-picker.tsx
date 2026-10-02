"use client";

import { ChevronDown } from "lucide-react";
import { BUYABLE_TICKERS, COMPARE_ONLY_TICKERS } from "@/lib/tickers";
import { TokenLogo } from "./badges";

/** Stock dropdown. A native <select> on purpose: it is keyboard and screen-reader complete and gives phones their own picker. */
export function StockPicker({
  value,
  onChange,
  id = "stock",
}: {
  value: string;
  onChange: (t: string) => void;
  id?: string;
}) {
  return (
    <label className="token-pill relative cursor-pointer pr-9" htmlFor={id}>
      <TokenLogo ticker={value} />
      <span className="sr-only">Stock</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[40px] cursor-pointer appearance-none bg-transparent pr-2 font-semibold text-fg outline-none"
        data-testid="stock-picker"
      >
        <optgroup label="You can buy">
          {BUYABLE_TICKERS.map((t) => (
            <option key={t.ticker} value={t.ticker} className="bg-[#1a1b1f]">
              {t.ticker} · {t.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="Compare only">
          {COMPARE_ONLY_TICKERS.map((t) => (
            <option key={t.ticker} value={t.ticker} className="bg-[#1a1b1f]">
              {t.ticker} · {t.name}
            </option>
          ))}
        </optgroup>
      </select>
      <ChevronDown
        size={16}
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg2"
      />
    </label>
  );
}
