import type { Metadata } from "next";
import { TradeClient } from "@/components/trade/trade-client";

export const metadata: Metadata = { title: "Trade tokenized shares at the best price · Tally" };

export default async function TradeIndex({
  searchParams,
}: {
  searchParams: Promise<{ usd?: string }>;
}) {
  const { usd } = await searchParams;
  const n = Number(usd);
  return <TradeClient ticker="NVDA" initialUsd={Number.isFinite(n) && n > 0 ? n : undefined} />;
}
