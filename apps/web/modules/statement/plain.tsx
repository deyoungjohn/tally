import { ModuleBoundary } from "@/components/module-boundary";
import { loadStatement } from "./view-model";

export function StatementPlain({ walletAddress }: { walletAddress?: string } = {}) {
  return (
    <ModuleBoundary
      module="statement"
      load={async () => {
        const vm = await loadStatement({ walletAddress });

        if (vm.state === "error") {
          return (
            <section aria-label="Statement Error">
              <p>Error loading statement: {vm.error}</p>
            </section>
          );
        }

        if (vm.state === "empty") {
          return (
            <section aria-label="Statement Empty">
              <p>{vm.reason ?? "Statement has no observations yet."}</p>
            </section>
          );
        }

        return (
          <section aria-label="Portfolio Statement">
            <header>
              <h2>Portfolio Statement</h2>
              <p>Wallet: {vm.walletAddress ?? "Unknown"}</p>
              <p>As Of: {vm.asOf}</p>
              <p>Source: {vm.source ?? "unknown"}</p>
              {vm.stale && <p>Notice: Statement data is stale ({vm.ageMs} ms old)</p>}
            </header>

            <div aria-label="Statement Totals">
              <p>Total Value: ${vm.totalValueUsd}</p>
              <p>Cost Basis: ${vm.totalCostBasisUsd}</p>
              <p>Realized P&L: ${vm.totalRealizedPnlUsd}</p>
              <p>Unrealized P&L: ${vm.totalUnrealizedPnlUsd}</p>
            </div>

            {vm.differsFromApiNote && (
              <p role="note" style={{ color: "orange" }}>
                {vm.differsFromApiNote}
              </p>
            )}

            {vm.convertedAtTodaysRatioNote && <p role="note">{vm.convertedAtTodaysRatioNote}</p>}

            {vm.notes.length > 0 && (
              <ul>
                {vm.notes.map((note, idx) => (
                  <li key={idx}>{note}</li>
                ))}
              </ul>
            )}

            {vm.lines.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Ticker</th>
                    <th>Issuer</th>
                    <th>Type</th>
                    <th>Tokens</th>
                    <th>Multiplier</th>
                    <th>Shares</th>
                    <th>Price/Share</th>
                    <th>Value</th>
                    <th>Realized P&L</th>
                    <th>Tx Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {vm.lines.map((line, idx) => (
                    <tr key={line.txHash ?? idx}>
                      <td>{line.date}</td>
                      <td>{line.ticker}</td>
                      <td>{line.issuer}</td>
                      <td>{line.type}</td>
                      <td>{line.amountTokens}</td>
                      <td>{line.multiplier}</td>
                      <td>{line.amountShares}</td>
                      <td>${line.pricePerShareUsd}</td>
                      <td>${line.valueUsd}</td>
                      <td>{line.realizedPnlUsd ? `$${line.realizedPnlUsd}` : "-"}</td>
                      <td>{line.txHash ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div>
              <button
                type="button"
                onClick={() => {
                  const csv = vm.exportActions.exportCsv();
                  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = vm.exportActions.csvFilename;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download Statement CSV
              </button>
            </div>
          </section>
        );
      }}
    />
  );
}
