"use client";
// The "Migrate stocks" tab on the Trade page: move a holding from one issuer to the other (sell for USDT, then buy the
// same stock from the other issuer). The two steps and their confirmations are `useMigrateFlow` / `MigrateSheet`; this
// tab only lists what can be moved and starts the flow. Shown only when the `switch` flag is on.

import { ArrowRight, Lock } from "lucide-react";
import type { PortfolioReport } from "@tally/engine";
import { MIN_SELL_USDT } from "@tally/config";
import { Button } from "@/components/motion/button";
import { LiveShares, LiveUsd } from "@/components/motion/live";
import { Tip } from "@/components/ui/tooltip";
import { useTallyWallet } from "@/components/wallet/wallet-context";
import { useJson } from "@/lib/hooks/use-json";
import { ISSUER_LABEL } from "@/lib/format";
import { isBuyable, tokenSymbol } from "@/lib/tickers";
import { companyName } from "@/components/portfolio/company-name";
import { TokenLogo } from "./badges";
import { OndoGate } from "./ondo-gate";
import type { useMigrateFlow } from "./use-migrate-flow";

type Part = PortfolioReport["groups"][number]["parts"][number];

/** Why a holding cannot be migrated, or null when it can. */
function blocked(p: Part, ondoClosed: string | null): string | null {
  if (p.issuer === "xstocks") return "No market to exit this token on BNB Chain.";
  if (ondoClosed) return ondoClosed;
  if (!isBuyable(p.ticker)) return `${p.ticker} can't be bought through Tally yet.`;
  if (p.valueUsd !== null && p.valueUsd < MIN_SELL_USDT)
    return `Too small to migrate: the sale must be at least $${MIN_SELL_USDT} and the buy at least 6 USDT.`;
  return null;
}

export function MigrateTab({ flow }: { flow: ReturnType<typeof useMigrateFlow> }) {
  const wallet = useTallyWallet();
  const portfolio = useJson<PortfolioReport>(
    wallet.authenticated && wallet.address ? `/api/portfolio?address=${wallet.address}` : null,
    { refreshMs: 10_000 },
  );
  const parts = (portfolio.data?.groups ?? [])
    .flatMap((g) => g.parts)
    .filter((p) => p.issuer === "ondo" || p.issuer === "bstock")
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  return (
    <section className="wrap pb-24 pt-6" aria-label="Migrate stocks" data-testid="migrate-tab">
      <h1 className="t-h2 !text-[clamp(28px,4.5vw,40px)]">Migrate stocks</h1>
      <p className="t-lead mt-3 max-w-[62ch]">
        Move a holding to the other issuer, keeping the same stock. Tally sells it for USDT, then
        buys the same stock from the other issuer. Each step is confirmed by you, and nothing is
        sent until you do.
      </p>

      {!wallet.authenticated ? (
        <div className="glass mt-6 max-w-[560px] p-6" data-testid="migrate-signed-out">
          <p className="font-semibold">Sign in to see what you can migrate</p>
          <p className="mt-1 text-fg2">Your holdings are read from your wallet.</p>
          <Button className="mt-4" onClick={() => wallet.login()} disabled={!wallet.ready}>
            <Lock size={16} aria-hidden /> Sign in
          </Button>
        </div>
      ) : portfolio.loading && !portfolio.data ? (
        <div className="skeleton mt-6 h-[120px] max-w-[560px]" aria-busy="true" />
      ) : portfolio.error && !portfolio.data ? (
        <p role="alert" className="mt-6 text-amber">
          {portfolio.error}
        </p>
      ) : parts.length === 0 ? (
        <p className="mt-6 text-fg2" data-testid="migrate-empty">
          You don&apos;t hold any Ondo or bStock tokens to migrate.
        </p>
      ) : (
        <ul className="m-0 mt-6 grid max-w-[720px] list-none gap-3 p-0">
          {parts.map((p) => (
            <OndoGate key={p.address} ticker={p.ticker} issuer={p.issuer}>
              {(ondoClosed) => {
                const to = p.issuer === "ondo" ? "bstock" : "ondo";
                const reason = blocked(p, ondoClosed);
                return (
                  <li className="panel p-4" data-testid={`migrate-row-${p.symbol}`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <TokenLogo ticker={p.ticker} />
                      <div className="min-w-0 flex-1">
                        <p className="mono text-[19px] font-bold leading-tight">{p.symbol}</p>
                        <p className="text-[13.5px] font-light text-fg2">
                          {companyName(p.ticker)} · {ISSUER_LABEL[p.issuer]}
                        </p>
                      </div>
                      <div className="text-right">
                        <LiveShares
                          value={p.shares}
                          className="num flex justify-end font-semibold"
                        />
                        <p className="t-meta">
                          shares · ≈ <LiveUsd value={p.valueUsd} />
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="t-meta flex items-center gap-1">
                        {p.symbol} <ArrowRight size={13} aria-hidden /> {tokenSymbol(p.ticker, to)}
                      </p>
                      {reason ? (
                        <Tip text={reason}>
                          <span className="inline-flex">
                            <Button
                              variant="glassy"
                              className="!h-9 !px-4 text-[14.5px]"
                              disabled
                              aria-label={`Migrate ${p.symbol} (unavailable)`}
                              data-testid={`migrate-${p.symbol}`}
                            >
                              Migrate
                            </Button>
                          </span>
                        </Tip>
                      ) : (
                        <Button
                          variant="glassy"
                          className="!h-9 !px-4 text-[14.5px]"
                          aria-label={`Migrate ${p.symbol} to ${tokenSymbol(p.ticker, to)}`}
                          data-testid={`migrate-${p.symbol}`}
                          onClick={() =>
                            void flow.open(
                              {
                                ticker: p.ticker,
                                issuer: p.issuer as "ondo" | "bstock",
                                symbol: p.symbol,
                                probeShares: p.shares,
                                probeUsd: p.valueUsd,
                              },
                              to,
                            )
                          }
                        >
                          Migrate to {tokenSymbol(p.ticker, to)}
                        </Button>
                      )}
                    </div>
                    {reason ? <p className="t-meta mt-2">{reason}</p> : null}
                  </li>
                );
              }}
            </OndoGate>
          ))}
        </ul>
      )}
    </section>
  );
}
