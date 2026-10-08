"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select";
import { cn } from "@/lib/utils";
import { BUYABLE_TICKERS, tokenPair } from "@/lib/tickers";
import { TokenLogo } from "./badges";

/** The five stocks Tally can buy, in beUI's Select (glass trigger and panel, unfolding animation). */
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
  return (
    <Select value={value} onValueChange={onChange} className={cn("w-[min(100%,260px)]", className)}>
      <SelectTrigger className="select-trigger" aria-label="Stock" data-testid="stock-picker">
        <span className="flex min-w-0 items-center gap-2.5">
          <TokenLogo ticker={value} />
          <SelectValue className="truncate" />
        </span>
      </SelectTrigger>
      <SelectContent className="select-panel">
        {BUYABLE_TICKERS.map((t) => (
          <SelectItem key={t.ticker} value={t.ticker}>
            {plain ? t.ticker : `${t.name} · ${tokenPair(t.ticker)}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
