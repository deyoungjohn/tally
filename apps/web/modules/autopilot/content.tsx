import { tokenSymbol } from "@/lib/tickers";
import { AutopilotPolicyForm } from "./policy-form";
import type { AutopilotVM } from "./view-model";

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
      <AutopilotPolicyForm vm={vm} />
      <h3>Collector</h3>
      <p>
        {vm.collector?.state ?? "never collected"} · age {vm.collector?.ageMs ?? "unknown"} ms
      </p>
      <h3>Positions</h3>
      <ul>
        {vm.positions?.map((p) => (
          <li key={p.token}>
            {p.ticker && p.issuer ? tokenSymbol(p.ticker, p.issuer) : "Unknown token"}:{" "}
            {p.shares ?? "unknown"} shares · ${p.usdValue ?? "unknown"} · grade{" "}
            {p.grade ?? "unknown"} · paused{" "}
            {p.paused === null ? "unknown" : p.paused ? "yes" : "no"} · age {p.ageMs ?? "unknown"}{" "}
            ms{p.stale ? " · stale" : ""}
            {p.warnings.length > 0 && <p>{p.warnings.join("; ")}</p>}
          </li>
        ))}
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
