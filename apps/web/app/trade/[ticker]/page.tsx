import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TradeClient } from "@/components/trade/trade-client";
import { PICKER_TICKERS, TICKER_RE, nameOf } from "@/lib/tickers";

type Props = { params: Promise<{ ticker: string }>; searchParams: Promise<{ usd?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const t = ticker.toUpperCase();
  return { title: `${nameOf(t)} (${t}): tokenized shares at the best price · Tally` };
}

export default async function TradePage({ params, searchParams }: Props) {
  const { ticker } = await params;
  const { usd } = await searchParams;
  const t = ticker.toUpperCase();
  if (!TICKER_RE.test(t) || !PICKER_TICKERS.some((p) => p.ticker === t)) notFound();
  const n = Number(usd);
  return <TradeClient ticker={t} initialUsd={Number.isFinite(n) && n > 0 ? n : undefined} />;
}
