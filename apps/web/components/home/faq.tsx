"use client";

import { useRouter } from "next/navigation";
import { FAQTabsCard } from "@/components/spectrumui/faq-tabs-card";

const TABS = [
  {
    label: "Basics",
    faqs: [
      {
        question: "Are these real shares?",
        answer:
          "No. They are tokens that track a US stock's price on BNB Chain. You don't own the underlying share or get shareholder rights, and the issuers' own terms apply.",
      },
      {
        question: "Is one token one share?",
        answer:
          "Sometimes, but it's not always the case. E.g. Ondo's NFLXon token is ten shares, while bStock's NFLXB is one. Tally always shows you share units, so prices compare fairly.",
      },
      {
        question: "Do I need to know crypto?",
        answer:
          "No, you don't need to be a crypto OG. Sign in with your email or Google account, deposit USDT and a few cents of BNB on BNB chain, and make your first purchase. We explain each step.",
      },
    ],
  },
  {
    label: "Buying",
    faqs: [
      {
        question: "What does it cost?",
        answer:
          "Tally adds no fee, for now. You pay the network fee, about two to five cents, and the price already includes the issuer's spread. The minimum purchase is $6.",
      },
      {
        question: "Why is the minimum $6?",
        answer:
          "Ondo requires at least $5 in dollars, and USDT is worth slightly under $1, so $6 always clears it.",
      },
      {
        question: "How does Tally pick the best price?",
        answer:
          "It quotes every issuer at the same moment, converts to shares, adds the network fee, and ranks by what you pay per share. It refreshes every 10 seconds.",
      },
    ],
  },
  {
    label: "Safety",
    faqs: [
      {
        question: "What if the price fluctuates while I confirm?",
        answer:
          "You'd see a minimum number of shares you'd receive first. If you'd receive fewer, the whole trade is reverted and your USDT stays in your wallet. You only pay the small network fee if a transaction was sent.",
      },
      {
        question: "Who holds my money?",
        answer:
          "You do. Everything is signed in your own wallet. Tally never handles your funds or keys.",
      },
      {
        question: "Where is it available?",
        answer:
          "Available in most countries except the US, Canada, the UK, Japan, the Netherlands, Iran, Cuba, North Korea, Syria, Crimea, Donetsk or Luhansk.",
      },
    ],
  },
];

export function HomeFaq() {
  const router = useRouter();
  return (
    <FAQTabsCard
      tabs={TABS}
      footerLabel="Read how it works"
      onFooterClick={() => router.push("/how-it-works")}
    />
  );
}
