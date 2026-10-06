"use client";
// The Portfolio screen built from the statement module's view models (holdings in shares from `PortfolioVM`, Activity from
// `ActivityVM`, Statement from `StatementVM`). Four designed states per tab: loading, empty, stale, degraded.

import { useEffect, useState } from "react";
import { ButtonLink } from "@/components/motion/button";
import { Segmented } from "@/components/motion/segmented";
import type { SellTarget } from "@/components/trade/use-sell-flow";
import { ComingSoon } from "@/components/trade/coming-soon";
import { useJson } from "@/lib/hooks/use-json";
import type { PortfolioTab, PortfolioVM, StatementVM } from "@/modules/statement/view-model";
import type { ActivityVM } from "@/modules/receipts/view-model";
import type { PortfolioReport } from "@tally/engine";
import { LiveNumber, LiveUsd } from "@/components/motion/live";
import { ActivityVmView } from "./activity-vm";
import { HoldingsVm } from "./holdings-vm";
import { StatementVmView } from "./statement-vm";
import { VmDegraded, VmEmpty, VmFreshness, VmSkeleton, usd, type VmEnvelope } from "./vm-shared";

const TAB_LABEL: Record<PortfolioTab, string> = {
  holdings: "Holdings",
  activity: "Activity",
  statement: "Statement",
};

/** A tab's data: the envelope's own degraded state wins, then the view model's own error, empty and ready states. */
function TabBody<T extends { state: string; reason?: string | null; error: string | null }>({
  name,
  env,
  error,
  emptyTitle,
  children,
}: {
  name: string;
  env: VmEnvelope<T> | null;
  error: string | null;
  emptyTitle: string;
  children: (vm: T) => React.ReactNode;
}) {
  if (!env) {
    return error ? (
      <p role="alert" className="text-amber">
        {error}
      </p>
    ) : (
      <VmSkeleton label={`Loading ${name}`} />
    );
  }
  if (env.degraded && env.vm === null)
    return <VmDegraded name={name} reason={env.reason} ageMs={env.ageMs} />;
  const vm = env.vm;
  if (!vm) return <VmDegraded name={name} reason={env.reason} ageMs={env.ageMs} />;
  if (vm.state === "error")
    return <VmDegraded name={name} reason={vm.error ?? "Couldn't load."} ageMs={env.ageMs} />;
  return (
    <>
      {vm.state === "empty" ? (
        <VmEmpty title={emptyTitle} reason={vm.reason ?? "Nothing here yet."} />
      ) : (
        children(vm)
      )}
    </>
  );
}

export function PortfolioVmPanel({
  address,
  onSell,
  refreshKey,
}: {
  address: string;
  onSell?: (t: SellTarget) => void;
  /** Changes when something happened that may have moved the holdings (a sale confirmed): refetch. */
  refreshKey?: number;
}) {
  const [tab, setTab] = useState<PortfolioTab>("holdings");
  const q = encodeURIComponent(address);
  const portfolio = useJson<VmEnvelope<PortfolioVM>>(`/api/vm/portfolio?address=${q}`, {
    refreshMs: 30_000,
  });
  const reload = portfolio.reload;
  useEffect(() => {
    if (refreshKey) reload();
  }, [refreshKey, reload]);
  // "Other assets": only `wallet.usdt` and `wallet.bnb` from the engine route (plain wallet balances). Its holdings groups,
  // shares and values are the float-based numbers the view model replaces, so they are never read or shown here.
  const balances = useJson<Pick<PortfolioReport, "wallet" | "asOf">>(
    `/api/portfolio?address=${q}`,
    { refreshMs: 30_000 },
  );
  const vm = portfolio.data?.vm ?? null;
  const tabs = vm?.availableTabs ?? ["holdings"];
  // A tab that stops being offered (its flag went off) falls back to Holdings.
  useEffect(() => {
    if (!tabs.includes(tab)) setTab("holdings");
  }, [tabs, tab]);

  const statement = useJson<VmEnvelope<StatementVM>>(
    tab === "statement" ? `/api/vm/statement?address=${q}` : null,
  );
  const activity = useJson<VmEnvelope<ActivityVM>>(
    tab === "activity" ? `/api/vm/activity?address=${q}` : null,
  );

  const env = portfolio.data;
  return (
    <div
      className="mt-8 grid grid-cols-1 gap-6 min-[981px]:grid-cols-[1.4fr_1fr]"
      data-testid="portfolio-vm"
    >
      <section aria-label="Portfolio" className="min-w-0">
        {tabs.length > 1 ? (
          <div className="mb-4 overflow-x-auto">
            <Segmented
              label="Portfolio section"
              value={tab}
              onChange={setTab}
              options={tabs.map((t) => ({ value: t, label: TAB_LABEL[t] }))}
            />
          </div>
        ) : null}

        {tab === "holdings" ? (
          <TabBody
            name="Portfolio"
            env={env}
            error={portfolio.error}
            emptyTitle="No tokenized shares yet"
          >
            {(v) => (
              <>
                <HoldingsVm vm={v} onSell={onSell} />
              </>
            )}
          </TabBody>
        ) : null}
        {tab === "activity" ? (
          <TabBody
            name="Activity"
            env={activity.data}
            error={activity.error}
            emptyTitle="No activity yet"
          >
            {(v) => <ActivityVmView vm={v} />}
          </TabBody>
        ) : null}
        {tab === "statement" ? (
          <TabBody
            name="Statement"
            env={statement.data}
            error={statement.error}
            emptyTitle="No statement yet"
          >
            {(v) => <StatementVmView vm={v} />}
          </TabBody>
        ) : null}

        {tab === "holdings" && env?.vm?.state === "empty" ? (
          <div className="mt-4 grid gap-2" data-testid="vm-empty-help">
            {env.vm.source === null ? (
              <p className="t-meta">
                No portfolio snapshot has been collected for this wallet yet. That is different from
                an empty wallet.
              </p>
            ) : null}
            <div>
              <ButtonLink href="/trade">Open Trade</ButtonLink>
            </div>
          </div>
        ) : null}
      </section>

      <aside className="grid content-start gap-4" aria-label="Summary">
        <div className="glass p-5">
          <p className="t-meta">Total value of tokenized stock holdings</p>
          <p className="t-big mt-1" data-testid="total-value">
            {vm && vm.state === "ready" ? usd(vm.totalValueUsd) : "–"}
          </p>
          {vm?.state === "ready" ? (
            <dl className="mt-3">
              <div className="detail-row">
                <dt>Unrealized gain or loss</dt>
                <dd>{usd(vm.totalUnrealizedPnlUsd)}</dd>
              </div>
              <div className="detail-row">
                <dt>Realized gain or loss</dt>
                <dd>{usd(vm.totalRealizedPnlUsd)}</dd>
              </div>
            </dl>
          ) : null}
          {env ? (
            <div className="mt-3">
              <VmFreshness
                stale={env.stale || (vm?.stale ?? false)}
                ageMs={vm?.ageMs ?? env.ageMs}
                source={vm?.source ?? null}
                fixtures={env.fixtures}
              />
            </div>
          ) : null}
        </div>
        <WalletBalances
          data={env ? balances.data : null}
          failed={!!balances.error}
          fixtures={env?.fixtures ?? false}
        />
        <ComingSoon items={["Dividends received as shares", "Sell to USDT", "Price alerts"]} />
      </aside>
    </div>
  );
}

/** A balance read older than this is not shown (a stale reading must not pass for the wallet's current balance). */
const BALANCES_MAX_AGE_MS = 120_000;

/**
 * USDT and BNB as plain wallet balances, apart from the share-true holdings. Hidden (never zeros) while loading, when the read
 * failed or when it is stale; on a fixture server it says the numbers are recorded, not live.
 */
function WalletBalances({
  data,
  failed,
  fixtures,
}: {
  data: Pick<PortfolioReport, "wallet" | "asOf"> | null;
  failed: boolean;
  fixtures: boolean;
}) {
  if (failed || !data?.wallet) return null;
  // A fixture server stamps its recordings with the recording time, not now: its age says nothing, and the label below says
  // what it is. On a live server a reading older than two minutes is not shown.
  const age = Date.now() - Date.parse(data.asOf);
  if (!fixtures && (!Number.isFinite(age) || age > BALANCES_MAX_AGE_MS)) return null;
  return (
    <div className="panel p-5" data-testid="wallet-balances">
      <p className="t-meta">Other assets in this wallet</p>
      <dl className="mt-2">
        <div className="detail-row">
          <dt>USDT</dt>
          <dd data-testid="balance-usdt">
            <LiveUsd value={data.wallet.usdt} />
          </dd>
        </div>
        <div className="detail-row">
          <dt>BNB (for network fees)</dt>
          <dd data-testid="balance-bnb">
            <LiveNumber value={data.wallet.bnb} decimals={5} />
          </dd>
        </div>
      </dl>
      {fixtures ? (
        <p className="t-meta mt-2 text-amber" data-testid="balances-fixture-label">
          Recorded fixture balances, not live.
        </p>
      ) : null}
    </div>
  );
}
