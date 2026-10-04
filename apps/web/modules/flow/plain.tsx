import { ModuleBoundary } from "@/components/module-boundary";
import {
  displayFlow,
  loadFlow,
  loadRadar,
  type RadarVM,
  type FlowPanelDisplay,
} from "./view-model";

export function FlowContent({ panel }: { panel: FlowPanelDisplay }) {
  return (
    <section aria-label={`Flow ${panel.ticker}`}>
      {panel.reason && <p>{panel.reason}</p>}
      {panel.issuers.map((issuer) => (
        <section key={issuer.issuer}>
          <h3>{issuer.issuer}</h3>
          <p>
            {issuer.sourceLabel} · {issuer.stale ? "Stale" : "Last update"}{" "}
            {Math.floor(issuer.ageMs / 60000)} min ago
          </p>
          {issuer.windows.map((w) => (
            <p key={w.window}>
              {w.window}: {w.netShares} net shares · {w.buys} buys · {w.sells} sells
              {w.reason ? ` · ${w.reason}` : ""}
            </p>
          ))}
          <p>
            Last real trade:{" "}
            {issuer.lastRealTradeAgeMs === null
              ? issuer.lastRealTradeReason
              : `${Math.floor(issuer.lastRealTradeAgeMs / 60000)} min ago`}
          </p>
          <p>
            Top ten holders excluding custody:{" "}
            {issuer.concentration === null
              ? issuer.concentrationReason
              : `${issuer.concentration}%`}
          </p>
          {issuer.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
          {issuer.whalePrints.map((p) => (
            <p key={`${p.txHash}:${p.side}:${p.shares}`}>
              Whale {p.side}: {p.shares} shares · ${p.usd} · {p.txHash}
            </p>
          ))}
        </section>
      ))}
    </section>
  );
}
export function FlowPlain({ ticker = "NVDA" }: { ticker?: string }) {
  return (
    <ModuleBoundary
      module="flow"
      load={async () => <FlowContent panel={displayFlow(await loadFlow(ticker))} />}
    />
  );
}
/** Grades remain outside the flag-controlled flow boundary. */
export function RadarContent({ vm }: { vm: RadarVM }) {
  return (
    <section aria-label="Radar">
      {vm.reason && <p>{vm.reason}</p>}
      {vm.cards.map((card) => (
        <article key={card.ticker}>
          <h2>{card.ticker}</h2>
          {card.grades.map((grade) => (
            <section key={grade.address}>
              <h3>
                {grade.symbol}: Grade {grade.grade}
              </h3>
              <p>Grade basis: {grade.gradeBasis}</p>
              {grade.flowReason && <p>{grade.flowReason}</p>}
              {grade.ghost && <p>Ghost market</p>}
              {grade.reasons.map((reason) => (
                <p key={reason}>{reason}</p>
              ))}
              <p>
                {grade.stale ? "Stale grade" : "Grade observed"} {Math.floor(grade.ageMs / 60000)}{" "}
                min ago
              </p>
            </section>
          ))}
          {card.flowPanel && (
            <ModuleBoundary
              module="flow"
              load={() => <FlowContent panel={displayFlow(card.flowPanel!)} />}
            />
          )}
        </article>
      ))}
    </section>
  );
}
export async function RadarPlain() {
  return <RadarContent vm={await loadRadar()} />;
}
