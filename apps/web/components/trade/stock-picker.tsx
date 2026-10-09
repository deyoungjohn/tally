"use client";

import { TokenIcon } from "@/components/ui/token-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select";
import { Search } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { BUYABLE_TICKERS } from "@/lib/tickers";

/** The five stocks Tally can buy, in beUI's Select (glass trigger and panel, unfolding animation). */
/** NVDA first (the default stock, so the highlight never has to travel to it), then A to Z by ticker. */
const ORDERED = [...BUYABLE_TICKERS].sort(
  (a, b) =>
    Number(b.ticker === "NVDA") - Number(a.ticker === "NVDA") || a.ticker.localeCompare(b.ticker),
);

export function StockPicker({
  value,
  onChange,
  className,
  plain = false,
}: {
  value: string;
  onChange: (t: string) => void;
  className?: string;
  /** Options read just the ticker (NVDA, AAPL, ...), for a narrow block. */
  plain?: boolean;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = ORDERED.filter(
    (t) => !needle || `${t.ticker} ${t.name}`.toLowerCase().includes(needle),
  );
  const matchSet = new Set(matches.map((t) => t.ticker));
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        setQuery("");
        onChange(v);
      }}
      className={cn("w-[min(100%,260px)]", className)}
    >
      <SelectTrigger className="select-trigger" aria-label="Stock" data-testid="stock-picker">
        <span className="flex min-w-0 items-center gap-2.5">
          <TokenIcon ticker={value} size={24} />
          <SelectValue className="truncate" />
        </span>
      </SelectTrigger>
      <SelectContent
        className="select-panel"
        maxListHeight={280}
        header={
          <label className="relative mb-1 block">
            <span className="sr-only">Search stocks</span>
            <Search
              size={14}
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg3"
            />
            <input
              data-select-search
              data-testid="stock-search"
              type="search"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search stocks"
              className="input !h-9 w-full !pl-8 text-[14px]"
            />
          </label>
        }
      >
        {matches.length === 0 ? (
          <li className="px-2.5 py-2 text-[14px] text-fg2" data-testid="stock-search-empty">
            No stock matches that.
          </li>
        ) : null}
        {ORDERED.map((t) => (
          <SelectItem
            key={t.ticker}
            value={t.ticker}
            hidden={!matchSet.has(t.ticker)}
            icon={<TokenIcon ticker={t.ticker} size={20} />}
          >
            {plain ? t.ticker : `${t.name} · ${t.ticker}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
