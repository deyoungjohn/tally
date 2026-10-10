"use client";
// The Portfolio screen built from the statement module's view models (holdings in shares from `PortfolioVM`, Activity from
// `ActivityVM`, Statement from `StatementVM`). Four designed states per tab: loading, empty, stale, degraded.

import { useEffect, useMemo, useState } from "react";
import { ButtonLink } from "@/components/motion/button";
import { Segmented } from "@/components/motion/segmented";
import type { SellTarget } from "@/components/trade/use-sell-flow";
import { ComingSoon } from "@/components/trade/coming-soon";
import { useJson } from "@/lib/hooks/use-json";
import type { PortfolioTab, PortfolioVM, StatementVM } from "@/modules/statement/view-model";
import type { ActivityVM } from "@/modules/receipts/view-model";
import type { PortfolioReport } from "@tally/engine";
import { LiveNumber, LiveUsd } from "@/components/motion/live";
import { mergeChainHoldings, untrackedTokens } from "./merge-chain";
import { recentLines } from "./recent-lines";
import { SmallBalancesLink, otherAssetsShown, type SmallBalance } from "./small-balances";
import { ActivityVmView } from "./activity-vm";
import { HoldingsVm, smallBalancesOf } from "./holdings-vm";
import { SuggestionsBlock } from "./suggestions";
import { StatementVmView, type ReceivedRow } from "./statement-vm";
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
  onMigrate,
  refreshKey,
}: {
  address: string;
  onSell?: (t: SellTarget) => void;
  onMigrate?: (t: SellTarget, toIssuer: "ondo" | "bstock") => void;
  /** Changes when something happened that may have moved the holdings (a sale confirmed): refetch. */
  refreshKey?: number;
}) {
  const [tab, setTab] = useState<PortfolioTab>("holdings");
  const q = encodeURIComponent(address);
  // A wallet the statement worker has not read yet answers "empty, suggestions unavailable". That is not the real answer, so the
  // page shows its loading state (never the empty card) and asks again every 2 s, for at most 8 s.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setGaveUp(true), 8000);
    return () => window.clearTimeout(id);
  }, []);
  const [settling, setSettling] = useState(true);
  const portfolio = useJson<VmEnvelope<PortfolioVM>>(`/api/vm/portfolio?address=${q}`, {
    refreshMs: settling && !gaveUp ? 2_000 : 30_000,
  });
  useEffect(() => {
    const v = portfolio.data?.vm;
    if (v && !(v.state === "empty" && v.suggestions?.state === "unavailable")) setSettling(false);
  }, [portfolio.data]);
  const reload = portfolio.reload;
  useEffect(() => {
    if (refreshKey) reload();
  }, [refreshKey, reload]);
  // "Other assets": only `wallet.usdt` and `wallet.bnb` from the engine route (plain wallet balances). Its holdings groups,
  // shares and values are the float-based numbers the view model replaces, so they are never read or shown here.
  const balances = useJson<Pick<PortfolioReport, "wallet" | "asOf" | "groups" | "failed">>(
    `/api/portfolio?address=${q}`,
    { refreshMs: 30_000 },
  );
  // The feed can miss tokens the wallet holds; the chain read fills them in, so every tokenized stock is counted and the total is
  // the sum of all of them. A fixture server's chain read is made up, so it is never merged.
  const feedEnv = portfolio.data;
  const mergedVm = useMemo(
    () =>
      feedEnv?.vm
        ? mergeChainHoldings(feedEnv.vm, feedEnv.fixtures ? null : (balances.data ?? null))
        : null,
    [feedEnv, balances.data],
  );
  const vm = mergedVm;
  const tabs = vm?.availableTabs ?? ["holdings"];
  // A tab that stops being offered (its flag went off) falls back to Holdings.
  useEffect(() => {
    if (!tabs.includes(tab)) setTab("holdings");
  }, [tabs, tab]);

  const statement = useJson<VmEnvelope<StatementVM>>(
    tab === "statement" ? `/api/vm/statement?address=${q}` : null,
  );
  const activity = useJson<VmEnvelope<ActivityVM>>(
    tab === "activity" || tab === "statement" ? `/api/vm/activity?address=${q}` : null,
  );

  const env0 = feedEnv && mergedVm ? { ...feedEnv, vm: mergedVm } : feedEnv;
  const env = settling && !gaveUp && !portfolio.error ? null : env0;
  // The Statement tab: tokens the feed never saw, and verified transactions it does not have yet.
  const untracked = useMemo(
    () =>
      feedEnv?.vm && !feedEnv.fixtures ? untrackedTokens(feedEnv.vm, balances.data ?? null) : [],
    [feedEnv, balances.data],
  );
  const transfers = useJson<{ transfers: ReceivedRow[] }>(
    tab === "statement" && untracked.length > 0 && address ? `/api/transfers?address=${q}` : null,
  );
  const recent = useMemo(
    () =>
      recentLines(
        activity.data?.vm ?? null,
        new Set(
          (statement.data?.vm?.lines ?? []).flatMap((l) =>
            l.txHash ? [l.txHash.toLowerCase()] : [],
          ),
        ),
      ),
    [activity.data, statement.data],
  );
  // Balances under $1 stay out of the list; the link below it opens them in a dialog.
  const small: SmallBalance[] = vm ? smallBalancesOf(vm) : [];
  return (
    <div className="mt-8" data-testid="portfolio-vm">
      {/* The tabs sit above both columns, so the cards on the left and the right start at the same height. */}
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
      <div className="grid grid-cols-1 gap-6 min-[981px]:grid-cols-[1.4fr_1fr]">
        <section aria-label="Portfolio" className="min-w-0">
          {tab === "holdings" ? (
            <>
              <TabBody
                name="Portfolio"
                env={env}
                error={portfolio.error}
                emptyTitle="No tokenized shares yet"
              >
                {(v) => <HoldingsVm vm={v} onSell={onSell} onMigrate={onMigrate} />}
              </TabBody>
              <SmallBalancesLink items={small} />
              <SuggestionsBlock suggestions={feedEnv?.vm?.suggestions} />
            </>
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
              {(v) => (
                <StatementVmView
                  vm={v}
                  valueToday={vm?.state === "ready" ? vm.totalValueUsd : undefined}
                  recent={recent}
                  untracked={untracked}
                  received={transfers.data?.transfers ?? []}
                  wallet={address}
                />
              )}
            </TabBody>
          ) : null}

          {tab === "holdings" && env?.vm?.state === "empty" ? (
            <div className="mt-4 grid gap-2" data-testid="vm-empty-help">
              {env.vm.source === null ? (
                <p className="t-meta">
                  No portfolio snapshot has been collected for this wallet yet. We can't say it's
                  empty, for now.
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
                  <dt>Unrealized PnL</dt>
                  <dd>{usd(vm.totalUnrealizedPnlUsd)}</dd>
                </div>
                <div className="detail-row">
                  <dt>Realized PnL</dt>
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
          <ComingSoon items={["Price alerts"]} />
        </aside>
      </div>
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
  // Anything under $1 is left out, with no way to show it.
  const shown = otherAssetsShown(data.wallet, (data as { bnbUsd?: number | null }).bnbUsd);
  if (!shown.usdt && !shown.bnb) return null;
  return (
    <div className="panel p-5" data-testid="wallet-balances">
      <p className="t-meta">Other assets in this wallet</p>
      <dl className="mt-2">
        {shown.usdt ? (
          <div className="detail-row">
            <dt>USDT</dt>
            <dd data-testid="balance-usdt">
              <LiveUsd value={data.wallet.usdt} />
            </dd>
          </div>
        ) : null}
        {shown.bnb ? (
          <div className="detail-row">
            <dt>BNB (for network fees)</dt>
            <dd data-testid="balance-bnb">
              <LiveNumber value={data.wallet.bnb} decimals={5} />
            </dd>
          </div>
        ) : null}
      </dl>
      {fixtures ? (
        <p className="t-meta mt-2 text-amber" data-testid="balances-fixture-label">
          Recorded fixture balances, not live.
        </p>
      ) : null}
    </div>
  );
}
