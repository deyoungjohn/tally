import { openStore } from "@tally/modkit";
import { tokenSymbol } from "@/lib/tickers";
import { ModuleBoundary } from "@/components/module-boundary";
import { loadAutopilot, type AutopilotVM } from "./view-model";

export function AutopilotContent({ vm }: { vm: AutopilotVM }) {
  return (
    <section aria-label="Autopilot">
      <h2>Autopilot — shadow mode</h2>
      <p>{vm.banner}</p>
      <p>{vm.walletLimit}</p>
      <p>State: {vm.state}</p>
      {vm.reason && <p>{vm.reason}</p>}
      {vm.error && <p role="alert">{vm.error}</p>}
      {vm.stale && <p>Stale snapshot: {vm.ageMs ?? "unknown"} ms</p>}
      <p>Source: {vm.source ?? "No observations"}</p>
      <p>
        Per trade: ${vm.caps.perTrade} (code ceiling ${vm.caps.perTradeCeiling})
      </p>
      <p>
        Per day: ${vm.caps.daily} (code ceiling ${vm.caps.dailyCeiling})
      </p>
      <p>Spent today: ${vm.spentToday}</p>
      <p>Kill switch: {vm.killSwitch ? "on" : "off"}</p>
      <h3>Armed rules</h3>
      <ul>
        {vm.armedRules.paused && (
          <li>Paused longer than {vm.armedRules.paused.longerThanHours} hours</li>
        )}
        {vm.armedRules["grade-drop"] && (
          <li>Grade at or below {vm.armedRules["grade-drop"].atOrBelow}</li>
        )}
        {vm.armedRules["price-threshold"] && <li>Per-share stop in the regular session</li>}
      </ul>
      <h3>Decision log</h3>
      {!vm.rows.length && <p>No decisions recorded.</p>}
      <ul>
        {vm.rows.map((row) => (
          <li key={row.alertId}>
            {tokenSymbol(row.ticker, row.issuer)} via {row.issuer}: {row.label}
            {row.usdCap && (
              <span>
                {" "}
                · up to ${row.usdCap} · {row.tokens} tokens
              </span>
            )}
            {row.reasons.length > 0 && <p>{row.reasons.join("; ")}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AutopilotPlain({
  walletAddress,
  vm,
}: { walletAddress?: string; vm?: AutopilotVM } = {}) {
  return (
    <ModuleBoundary
      module="autopilot"
      fallback={vm ? <AutopilotContent vm={vm} /> : undefined}
      load={async (health) => {
        if (vm) return <AutopilotContent vm={vm} />;
        const store = openStore();
        try {
          return (
            <AutopilotContent
              vm={await loadAutopilot({ walletAddress, store, health, onWarn: console.warn })}
            />
          );
        } finally {
          store.close();
        }
      }}
    />
  );
}
