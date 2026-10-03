"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select";
import { cn } from "@/lib/utils";
import { BUYABLE_TICKERS } from "@/lib/tickers";
import { TokenLogo } from "./badges";

/** The five stocks Tally can buy, in beUI's Select (glass trigger and panel, unfolding animation). */
export function StockPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (t: string) => void;
  className?: string;
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
            {`${t.ticker} · ${t.name}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
