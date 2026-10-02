import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TradeClient } from "@/components/trade/trade-client";
import { TICKER_RE, isBuyable, nameOf } from "@/lib/tickers";

type Props = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const t = ticker.toUpperCase();
  return { title: `${nameOf(t)} (${t}) in shares · Tally` };
}

export default async function TradePage({ params }: Props) {
  const { ticker } = await params;
  const t = ticker.toUpperCase();
  if (!TICKER_RE.test(t)) notFound();
  return <TradeClient ticker={t} name={nameOf(t)} buyable={isBuyable(t)} />;
}
