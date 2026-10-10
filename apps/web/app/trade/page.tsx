import type { Metadata } from "next";
import { TradeClient } from "@/components/trade/trade-client";

export const metadata: Metadata = {
  title: "Trade | Tally",
  description:
    "Compare Ondo, bStocks and xStocks in share units and buy tokenized stocks at the best price with a minimum-shares guarantee.",
};

export default async function TradeIndex({
  searchParams,
}: {
  searchParams: Promise<{ usd?: string }>;
}) {
  const { usd } = await searchParams;
  const n = Number(usd);
  return <TradeClient ticker="NVDA" initialUsd={Number.isFinite(n) && n > 0 ? n : undefined} />;
}
