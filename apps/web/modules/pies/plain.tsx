import { ModuleBoundary } from "@/components/module-boundary";
import { formatUnits } from "@tally/core";
import { openStore } from "@tally/modkit";
import { loadPies, type PiesViewModel } from "./view-model";

const usd = (amount: string) => formatUnits(BigInt(amount), 18, 2);
export function PiesContent({ vm }: { vm: PiesViewModel }) {
  return (
    <section aria-label="Pies">
      {vm.reason && <p>{vm.reason}</p>}
      {vm.error && <p role="alert">{vm.error}</p>}
      {vm.ageMs !== null && (
        <p>
          {vm.stale ? "Stale snapshot" : "Snapshot age"}: {vm.ageMs} ms · {vm.source}
        </p>
      )}
      {vm.templates.templates.map((t) => (
        <article key={t.id}>
          <h2>{t.name}</h2>
          <p>{t.description}</p>
          <p>{t.executable ? "Allocation template" : "Preview; not executable"}</p>
          <ul>
            {t.holdings.map((h) => (
              <li key={h.ticker}>
                {h.ticker}: {h.targetWeightBps / 100}%
              </li>
            ))}
          </ul>
          {t.unavailable.map((u) => (
            <p key={u.ticker}>{u.reason}</p>
          ))}
        </article>
      ))}
      {vm.pie && (
        <section aria-label="Current allocation">
          <h2>{vm.pie.name}: current vs target</h2>
          {vm.pie.holdings.map((h) => (
            <p key={h.ticker}>
              {h.ticker}: ${usd(h.valueE18)} · current {h.currentWeightBps / 100}% · target{" "}
              {h.targetWeightBps / 100}% · drift {h.driftBps} bps
              {!h.fullyValued && " · Incomplete valuation"}
            </p>
          ))}
          {[...vm.pie.unavailable, ...vm.pie.excluded].map((e, i) => (
            <p key={`${e.ticker}:${i}`}>
              {e.ticker}: {e.reason}
            </p>
          ))}
        </section>
      )}
      <section aria-label="Rebalance plan">
        {vm.plan.reason && <p>{vm.plan.reason}</p>}
        {vm.plan.legs.map((leg) => (
          <p key={leg.id}>
            {leg.sequence}. {leg.side} {leg.ticker} via {leg.issuer}:{" "}
            {leg.side === "sell"
              ? `${leg.amountTokens} raw tokens`
              : `${usd(leg.amountUsdtE18)} USDT`}{" "}
            (${usd(leg.valueE18)})
          </p>
        ))}
        {vm.plan.deferred.map((leg) => (
          <p key={leg.id}>
            Deferred {leg.side} {leg.ticker}: ${usd(leg.valueE18)} · {leg.reason}
          </p>
        ))}
        {vm.plan.totals && (
          <p>
            Buy budget: {usd(vm.plan.totals.buyBudgetUsdtE18)} USDT · Buys:{" "}
            {usd(vm.plan.totals.buyUsdtE18)} USDT · Unspent: {usd(vm.plan.totals.unspentUsdtE18)}{" "}
            USDT
          </p>
        )}
        {vm.plan.partialState && <p>{vm.plan.partialState}</p>}
        {vm.plan.run?.legs.map((leg) => (
          <p key={leg.id}>
            {leg.id}: {leg.status} {leg.txHash} {leg.reason}
          </p>
        ))}
        {vm.plan.notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </section>
      {vm.notes.map((note, i) => (
        <p key={i}>{note}</p>
      ))}
    </section>
  );
}

export function PiesPlain({ wallet, vm }: { wallet?: string; vm?: PiesViewModel }) {
  return (
    <ModuleBoundary
      module="pies"
      load={async () => {
        if (vm) return <PiesContent vm={vm} />;
        if (!wallet) return <PiesContent vm={await loadPies()} />;
        const store = openStore();
        try {
          return <PiesContent vm={await loadPies({ wallet, store })} />;
        } finally {
          store.close();
        }
      }}
      fallback={vm ? <PiesContent vm={vm} /> : <p>Pies has no successful update yet.</p>}
    />
  );
}
