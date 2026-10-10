// The four sample cards beside the hero's rolling line. They are illustrations with made-up round numbers, labelled "Example":
// nothing here is live data. Matching copy lives in the sections below.

import { ArrowRight, Bell, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

function Sample({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="glass flex h-full flex-col justify-center p-5 min-[561px]:p-6"
      data-testid="hero-sample"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[18px] font-bold">{title}</p>
        <span className="t-meta rounded-full border border-line px-2.5 py-0.5">Example</span>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="detail-row">
    <dt>{k}</dt>
    <dd>{v}</dd>
  </div>
);

function Migrate() {
  return (
    <Sample title="Migrate NVDAon to NVDAB">
      <div className="flex items-center gap-3">
        <span className="panel flex-1 p-3">
          <span className="t-meta block">Step 1 · you sell</span>
          <span className="num block text-[19px] font-bold">0.250 NVDAon</span>
        </span>
        <ArrowRight size={18} aria-hidden className="shrink-0 text-fg2" />
        <span className="panel flex-1 p-3">
          <span className="t-meta block">Step 2 · you buy</span>
          <span className="num block text-[19px] font-bold">0.249 NVDAB</span>
        </span>
      </div>
      <dl className="m-0 mt-4">
        <Row k="Shares you gave up" v="2.500" />
        <Row k="Shares you received" v="2.490" />
        <Row k="Dollar difference" v="$0.00" />
      </dl>
      <p className="t-meta mt-3">Two confirmed steps, then a receipt that compares the shares.</p>
    </Sample>
  );
}

function Alerts() {
  const items: [string, string][] = [
    ["NVDAon", "Trading is paused by the issuer."],
    ["AAPLB", "Shares per token changed from 1.000 to 1.002."],
    ["TSLAx", "Liquidity grade dropped from B to D."],
  ];
  return (
    <Sample title="Guardian alerts">
      <ul className="m-0 grid list-none gap-3 p-0">
        {items.map(([t, m]) => (
          <li key={t} className="panel flex items-start gap-3 p-3">
            <Bell size={16} aria-hidden className="mt-1 shrink-0 text-[var(--orange-text)]" />
            <span className="min-w-0">
              <span className="block font-semibold">{t}</span>
              <span className="block text-[15px] text-fg2">{m}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="t-meta mt-3">Sent to you on Telegram as it happens.</p>
    </Sample>
  );
}

function Baskets() {
  const stocks = ["NVDAB", "AAPLB", "GOOGLB", "MSFTB", "METAB"];
  return (
    <Sample title="Big Tech basket">
      <p className="num text-[28px] font-bold leading-none">$30</p>
      <p className="t-meta mt-1">budget, 20% to each stock</p>
      <ul className="m-0 mt-4 grid list-none gap-2.5 p-0">
        {stocks.map((s) => (
          <li key={s} className="flex items-center gap-3">
            <span className="w-[68px] shrink-0 font-semibold">{s}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full w-1/5 min-w-[20%] rounded-full bg-[var(--orange)]" />
            </span>
            <span className="num w-[44px] text-right text-fg2">$6.00</span>
          </li>
        ))}
      </ul>
      <p className="t-meta mt-3">Each stock is bought with its own guaranteed minimum.</p>
    </Sample>
  );
}

function Radar() {
  const rows: [string, string, string, boolean][] = [
    ["NVDAon", "10 shares per token", "Liquid", true],
    ["AAPLB", "1 share per token", "Liquid", true],
    ["TSLAx", "$10 traded in 24 hours", "Not Tradable", false],
  ];
  return (
    <Sample title="Radar">
      <ul className="m-0 grid list-none gap-3 p-0">
        {rows.map(([t, note, badge, ok]) => (
          <li key={t} className="panel flex items-center justify-between gap-3 p-3">
            <span className="min-w-0">
              <span className="block font-semibold">{t}</span>
              <span className="block text-[15px] text-fg2">{note}</span>
            </span>
            <span className={ok ? "badge badge-up" : "badge badge-amber"}>{badge}</span>
          </li>
        ))}
      </ul>
      <p className="t-meta mt-3 flex items-center gap-2">
        <ShieldCheck size={14} aria-hidden /> One token can be ten shares. Radar says so before you
        buy.
      </p>
    </Sample>
  );
}

export const HeroSamples: ReactNode[] = [
  <Migrate key="m" />,
  <Alerts key="a" />,
  <Baskets key="b" />,
  <Radar key="r" />,
];
