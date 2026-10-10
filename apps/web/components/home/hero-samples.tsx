// The cards in the hero carousel. They share one layout, like a listing card: a picture area on top (an illustration of the
// feature with made-up round numbers, labelled "Example"), then a title, two lines of text and a small meta line. Nothing here
// is live data; the live trade card replaces the first one when it is tapped (see `hero-stage.tsx`).

import {
  ArrowLeftRight,
  Bell,
  MousePointerClick,
  Radar as RadarIcon,
  ShoppingBasket,
} from "lucide-react";
import type { ReactNode } from "react";

export interface HeroCardSpec {
  key: string;
  title: string;
  text: string;
  meta: ReactNode;
  art: ReactNode;
}

const Chip = ({ children }: { children: ReactNode }) => (
  <span className="whitespace-nowrap rounded-full border border-white/20 bg-black/40 px-3 py-1.5 text-center text-[13.5px] font-semibold">
    {children}
  </span>
);

const Meta = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
  <span className="flex items-center gap-2 text-[14.5px] text-fg2">
    {icon}
    {children}
  </span>
);

export const HERO_CARDS: HeroCardSpec[] = [
  {
    key: "trade",
    title: "Trade at the best prices",
    text: "Compare every issuer in share units and buy from the cheapest, with the shares you get guaranteed.",
    meta: <Meta icon={<MousePointerClick size={16} aria-hidden />}>Tap to try it live</Meta>,
    art: (
      <div className="grid h-full content-center gap-3 px-6">
        <span className="t-meta">You pay</span>
        <span className="num text-[44px] font-bold leading-none">$6</span>
        <span className="t-meta">You receive at the best price</span>
        <span className="num text-[26px] font-bold leading-none">
          0.026 <span className="text-[17px] text-fg2">NVDAon shares</span>
        </span>
      </div>
    ),
  },
  {
    key: "migrate",
    title: "Migrate across issuers",
    text: "Move a holding from one issuer to another in two confirmed steps. A receipt compares the shares.",
    meta: <Meta icon={<ArrowLeftRight size={16} aria-hidden />}>Ondo to bStock</Meta>,
    art: (
      <div className="grid h-full content-center gap-4 px-6">
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
          <span className="panel flex min-w-0 flex-col gap-1 p-3">
            <span className="t-meta">You sell</span>
            <span className="num text-[22px] font-bold leading-none">0.250</span>
            <span className="text-[14px] font-semibold text-fg2">NVDAon</span>
          </span>
          <span className="grid place-items-center">
            <ArrowLeftRight size={18} aria-hidden className="text-[var(--orange-text)]" />
          </span>
          <span className="panel flex min-w-0 flex-col gap-1 p-3">
            <span className="t-meta">You buy</span>
            <span className="num text-[22px] font-bold leading-none">0.249</span>
            <span className="text-[14px] font-semibold text-fg2">NVDAB</span>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Chip>2.500 shares out</Chip>
          <Chip>2.490 shares in</Chip>
        </div>
      </div>
    ),
  },
  {
    key: "alerts",
    title: "Alerts about your holdings",
    text: "A pause, a change in shares per token or a drop in liquidity, sent to you on Telegram as it happens.",
    meta: <Meta icon={<Bell size={16} aria-hidden />}>Guardian</Meta>,
    art: (
      <div className="grid h-full content-center gap-2.5 px-6">
        {(
          [
            ["NVDAon", "Trading paused by the issuer"],
            ["AAPLB", "Shares per token 1.000 to 1.002"],
            ["TSLAx", "Liquidity grade fell from B to D"],
          ] as const
        ).map(([t, m]) => (
          <span key={t} className="panel flex items-center gap-3 p-2.5">
            <Bell size={15} aria-hidden className="shrink-0 text-[var(--orange-text)]" />
            <span className="min-w-0 text-[14.5px] leading-tight">
              <b className="block">{t}</b>
              <span className="text-fg2">{m}</span>
            </span>
          </span>
        ))}
      </div>
    ),
  },
  {
    key: "baskets",
    title: "Stock baskets, no hassle",
    text: "Pick a basket, set a budget and the weights, and Tally buys each stock with its own guaranteed minimum.",
    meta: <Meta icon={<ShoppingBasket size={16} aria-hidden />}>Big Tech · $30</Meta>,
    art: (
      <div className="grid h-full content-center gap-2.5 px-6">
        {["NVDAB", "AAPLB", "GOOGLB", "MSFTB", "METAB"].map((s) => (
          <span key={s} className="flex items-center gap-3 text-[14.5px]">
            <span className="w-[62px] shrink-0 font-semibold">{s}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/15">
              <span className="block h-full w-[40%] rounded-full bg-[var(--orange)]" />
            </span>
            <span className="num w-[40px] text-right text-fg2">$6</span>
          </span>
        ))}
      </div>
    ),
  },
  {
    key: "radar",
    title: "Spot liquid tokens",
    text: "Every token is graded A to F, and unit traps, like ten shares in one token, are flagged before you buy.",
    meta: <Meta icon={<RadarIcon size={16} aria-hidden />}>Radar</Meta>,
    art: (
      <div className="grid h-full content-center gap-2.5 px-6">
        {(
          [
            ["NVDAon", "10 shares per token", "Liquid", true],
            ["AAPLB", "1 share per token", "Liquid", true],
            ["TSLAx", "$10 traded in 24 h", "Not Tradable", false],
          ] as const
        ).map(([t, n, b, ok]) => (
          <span key={t} className="panel flex items-center justify-between gap-3 p-2.5">
            <span className="min-w-0 text-[14.5px] leading-tight">
              <b className="block">{t}</b>
              <span className="text-fg2">{n}</span>
            </span>
            <span className={ok ? "badge badge-up" : "badge badge-amber"}>{b}</span>
          </span>
        ))}
      </div>
    ),
  },
];
