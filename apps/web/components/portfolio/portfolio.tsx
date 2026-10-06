"use client";

import { ArrowRight, Lock, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { PortfolioReport } from "@tally/engine";
import { Button, ButtonLink } from "@/components/motion/button";
import { ComingSoon } from "@/components/trade/coming-soon";
import { GradeBadge, TokenLogo } from "@/components/trade/badges";
import { SellSheet } from "@/components/trade/sell-sheet";
import { useSellFlow } from "@/components/trade/use-sell-flow";
import { useModuleFlags } from "@/lib/hooks/use-flags";
import { useTallyWallet } from "@/components/wallet/wallet-context";
import { useJson } from "@/lib/hooks/use-json";
import { MIN_SELL_USDT } from "@tally/config";
import { Tip } from "@/components/ui/tooltip";
import { ISSUER_LABEL, fmtUsd } from "@/lib/format";
import { nameOf, tokenPair } from "@/lib/tickers";
import { LiveNumber, LiveShares, LiveUsd } from "@/components/motion/live";
import { LearnMore } from "@/components/learn-more";

type Group = PortfolioReport["groups"][number];
type Part = Group["parts"][number];

export function HoldingGroup({
  g,
  example,
  onSell,
}: {
  g: Group;
  example?: boolean;
  /** Present only when selling is switched on and this is the signed-in wallet's own portfolio. xStocks tokens get no Sell action. */
  onSell?: (p: Part) => void;
}) {
  return (
    <li className="panel list-none p-5" data-testid={`group-${g.ticker}`}>
      <div className="flex items-center gap-3">
        <TokenLogo ticker={g.ticker} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{nameOf(g.ticker)}</p>
          <p className="t-meta mono">{g.parts.map((x) => x.symbol).join(" · ")}</p>
        </div>
        <div className="text-right">
          <LiveShares
            value={g.shares}
            className="num flex justify-end text-[23px] font-bold tracking-tight"
          />
          <p className="t-meta flex items-center justify-end gap-1">
            shares
            {g.valueUsd === null ? null : (
              <>
                {" · ≈ "}
                <LiveUsd value={g.valueUsd} />
              </>
            )}
          </p>
        </div>
      </div>
      <ul className="m-0 mt-4 grid list-none gap-2 p-0">
        {g.parts.map((p) => (
          <li
            key={p.address}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[14px] bg-white/[0.03] px-3 py-2 text-[14.5px]"
          >
            <span className="flex items-center gap-2">
              <GradeBadge grade={p.grade} className="!h-6 !w-6 !text-[12px]" />
              <span
                className="text-[16px] font-bold text-fg"
                data-testid={`holding-symbol-${p.symbol}`}
              >
                {p.symbol}
              </span>
              <span
                className="text-[12.5px] font-light text-fg3"
                data-testid={`holding-issuer-${p.symbol}`}
              >
                {ISSUER_LABEL[p.issuer]}
              </span>
            </span>
            <span className="num text-fg2">
              <LiveNumber value={p.tokens} decimals={6} /> tokens ×{" "}
              {Number(p.multiplier.toFixed(6))} ={" "}
              <b className="text-fg">
                <LiveShares value={p.shares} />
              </b>
            </span>
            {onSell && p.issuer !== "xstocks" ? (
              p.valueUsd !== null && p.valueUsd < MIN_SELL_USDT ? (
                // Worth less than the smallest sale: unclickable, and the tooltip says why.
                <Tip
                  text={`This holding is worth ${fmtUsd(p.valueUsd)}, below the $${MIN_SELL_USDT} minimum sale.`}
                >
                  <span className="inline-flex">
                    <Button
                      variant="glassy"
                      className="!h-9 !px-4 text-[14.5px]"
                      disabled
                      aria-label={`Sell ${p.symbol} (below the $${MIN_SELL_USDT} minimum sale)`}
                      data-testid={`sell-${p.symbol}`}
                    >
                      Sell
                    </Button>
                  </span>
                </Tip>
              ) : (
                <Button
                  variant="glassy"
                  className="!h-9 !px-4 text-[14.5px]"
                  onClick={() => onSell(p)}
                  aria-label={`Sell ${p.symbol}`}
                  data-testid={`sell-${p.symbol}`}
                >
                  Sell
                </Button>
              )
            ) : null}
          </li>
        ))}
      </ul>
      {example ? null : (
        <Link
          href={`/trade/${g.ticker}`}
          className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-[14px] text-blue"
        >
          Buy more {nameOf(g.ticker)} <ArrowRight size={13} aria-hidden />
        </Link>
      )}
    </li>
  );
}

/** The two recorded test buys (IDEAS F11), used to show what a portfolio looks like before anyone has signed in. Labelled as an example. */
export const EXAMPLE_GROUP: Group = {
  ticker: "NVDA",
  shares: 0.025674701 + 0.025704894,
  valueUsd: (0.025674701 + 0.025704894) * 233.9354,
  referencePrice: 233.9354,
  parts: [
    {
      ticker: "NVDA",
      symbol: "NVDAB",
      issuer: "bstock",
      address: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
      tokens: 0.025654736,
      multiplier: 1.000778,
      shares: 0.025674701,
      valueUsd: 0.025674701 * 233.9354,
      grade: "A",
    },
    {
      ticker: "NVDA",
      symbol: "NVDAon",
      issuer: "ondo",
      address: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
      tokens: 0.025660879,
      multiplier: 1.001715,
      shares: 0.025704894,
      valueUsd: 0.025704894 * 233.9354,
      grade: "A",
    },
  ],
};

const ADDR = /^0x[0-9a-fA-F]{40}$/;

export function PortfolioPage() {
  const wallet = useTallyWallet();
  const [typed, setTyped] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);

  // ?address= lets anyone look at any wallet read-only (blueprint §11).
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("address");
    if (a && ADDR.test(a)) setViewing(a);
  }, []);
  const address = viewing ?? (wallet.authenticated ? wallet.address : undefined) ?? null;
  const { data, error, loading, reload } = useJson<PortfolioReport>(
    address ? `/api/portfolio?address=${address}` : null,
    { refreshMs: 10_000 },
  );

  // Selling: behind FEATURE_SELL (read through /api/modules/health), and only on the signed-in wallet's own holdings.
  const flags = useModuleFlags();
  const sell = useSellFlow();
  const own =
    wallet.authenticated &&
    !!wallet.address &&
    address?.toLowerCase() === wallet.address.toLowerCase();
  const canSell = flags.sell === true && own;
  useEffect(() => {
    if (sell.phase.name === "confirmed") reload();
  }, [sell.phase.name, reload]);

  return (
    <main id="main" className="wrap pb-24 pt-10 min-[561px]:pt-14">
      <p className="t-kicker">Portfolio</p>
      <h1 className="t-h2 mt-3 max-w-[22ch]">Your tokenized shares, counted in shares.</h1>
      <p className="t-lead mt-3 max-w-[62ch]">
        Holdings from different issuers add up in share units, so 1.2 shares from Ondo and 0.5 from
        bStock read as 1.7 shares, not two confusing token balances. <LearnMore concept="shares" />
      </p>

      {!address ? (
        <div className="mt-8 grid grid-cols-1 gap-6 min-[981px]:grid-cols-2">
          <section className="glass p-6 min-[561px]:p-8" aria-label="Sign in">
            <Wallet size={28} aria-hidden />
            <h2 className="t-h3 mt-4">Sign in to see your holdings</h2>
            <p className="mt-2 text-fg2">
              Your portfolio is read from the chain, so nothing needs to be stored. Or paste any
              wallet address to look at it.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button onClick={() => wallet.login()} disabled={!wallet.ready}>
                <Lock size={16} aria-hidden /> Sign in
              </Button>
              <ButtonLink href="/trade" variant="glassy">
                Buy your first shares
              </ButtonLink>
            </div>
            <form
              className="mt-6 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (ADDR.test(typed.trim())) setViewing(typed.trim());
              }}
            >
              <label className="min-w-0 flex-1">
                <span className="sr-only">Wallet address</span>
                <input
                  className="input mono"
                  placeholder="0x… wallet address"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  aria-invalid={typed !== "" && !ADDR.test(typed.trim())}
                />
              </label>
              <Button variant="glassy" type="submit" disabled={!ADDR.test(typed.trim())}>
                View
              </Button>
            </form>
          </section>
          <section aria-label="Example portfolio">
            <p className="t-meta mb-2">Example: the two recorded test buys (not a real account)</p>
            <ul className="m-0 grid list-none gap-3 p-0">
              <HoldingGroup g={EXAMPLE_GROUP} example />
            </ul>
          </section>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 min-[981px]:grid-cols-[1.4fr_1fr]">
          <section aria-label="Holdings">
            {error && !data ? (
              <p role="alert" className="text-amber">
                {error}
              </p>
            ) : null}
            {!data ? (
              <div className="grid gap-3" aria-busy={loading}>
                <div className="skeleton h-[160px]" />
                <div className="skeleton h-[160px]" />
              </div>
            ) : data.groups.length === 0 ? (
              <div className="glass p-6 min-[561px]:p-8" data-testid="empty-portfolio">
                <h2 className="t-h3">No tokenized shares yet</h2>
                <p className="mt-2 text-fg2">
                  This wallet doesn&apos;t hold any of the stocks Tally covers. Buy from $6.
                </p>
                <div className="mt-5">
                  <ButtonLink href="/trade">Open Trade</ButtonLink>
                </div>
              </div>
            ) : (
              <ul className="m-0 grid list-none gap-3 p-0">
                {data.groups.map((g) => (
                  <HoldingGroup
                    key={g.ticker}
                    g={g}
                    onSell={
                      canSell
                        ? (p) =>
                            void sell.open({
                              ticker: p.ticker,
                              issuer: p.issuer as "ondo" | "bstock",
                              symbol: p.symbol,
                              probeShares: p.shares,
                              probeUsd: p.valueUsd,
                            })
                        : undefined
                    }
                  />
                ))}
              </ul>
            )}
            {data?.failed.length ? (
              <p className="t-meta mt-3 text-amber" role="status">
                Couldn&apos;t read {data.failed.map((f) => tokenPair(f.ticker)).join(", ")}; those
                are missing from the totals above.
              </p>
            ) : null}
          </section>
          <aside className="grid content-start gap-4" aria-label="Summary">
            <div className="glass p-5">
              <p className="t-meta">Total value of tokenized stock holdings</p>
              <p className="t-big mt-1" data-testid="total-value">
                <LiveUsd value={data?.totalValueUsd} />
              </p>
            </div>
            <div className="panel p-5">
              <p className="t-meta">Other assets in this wallet</p>
              <dl className="mt-2">
                <div className="detail-row">
                  <dt>USDT</dt>
                  <dd>
                    <LiveUsd value={data?.wallet.usdt} />
                  </dd>
                </div>
                <div className="detail-row">
                  <dt>BNB (for network fees)</dt>
                  <dd>
                    <LiveNumber value={data?.wallet.bnb} decimals={5} />
                  </dd>
                </div>
              </dl>
            </div>
            <ComingSoon items={["Dividends received as shares", "Sell to USDT", "Price alerts"]} />
          </aside>
        </div>
      )}
      {flags.sell === true ? <SellSheet flow={sell} /> : null}
    </main>
  );
}
