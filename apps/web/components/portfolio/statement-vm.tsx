"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/motion/button";
import { ISSUER_LABEL, shortHash } from "@/lib/format";
import type { StatementVM } from "@/modules/statement/view-model";
import { sharesStr, usd } from "./vm-shared";

const signed = (s: string) => (s.startsWith("-") ? "text-red" : "text-fg");

/** Downloads the CSV the statement module already built (filename and content come from its view model). */
function downloadCsv(vm: StatementVM) {
  const blob = new Blob([vm.csv.content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = vm.csv.filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function StatementVmView({ vm }: { vm: StatementVM }) {
  const anyRealized = vm.lines.some((l) => l.realizedPnlUsd !== undefined);
  return (
    <div className="grid gap-4" data-testid="vm-statement">
      <section className="glass p-5" aria-label="Statement totals">
        <dl>
          <div className="detail-row">
            <dt>Value today</dt>
            <dd data-testid="st-value">{usd(vm.totalValueUsd)}</dd>
          </div>
          <div className="detail-row">
            <dt>Cost basis</dt>
            <dd data-testid="st-cost">{usd(vm.totalCostBasisUsd)}</dd>
          </div>
          <div className="detail-row">
            <dt>Unrealized gain or loss</dt>
            <dd className={signed(vm.totalUnrealizedPnlUsd)} data-testid="st-unrealized">
              {usd(vm.totalUnrealizedPnlUsd)}
            </dd>
          </div>
          <div className="detail-row">
            <dt>Realized gain or loss</dt>
            <dd className={signed(vm.totalRealizedPnlUsd)} data-testid="st-realized">
              {anyRealized ? usd(vm.totalRealizedPnlUsd) : "unknown"}
            </dd>
          </div>
        </dl>
        {anyRealized ? null : (
          <p className="t-meta mt-2" data-testid="st-realized-reason">
            No sale in this statement could be matched to a cost, so no realized figure is shown.
          </p>
        )}
        <div className="mt-4">
          <Button variant="glassy" onClick={() => downloadCsv(vm)} data-testid="st-csv">
            <Download size={16} aria-hidden /> Download statement CSV
          </Button>
        </div>
      </section>

      {vm.differsFromApiNote ? (
        <p role="note" className="t-meta text-amber" data-testid="st-differs">
          {vm.differsFromApiNote}
        </p>
      ) : null}
      {vm.convertedAtTodaysRatioNote ? (
        <p role="note" className="t-meta" data-testid="st-converted">
          {vm.convertedAtTodaysRatioNote}
        </p>
      ) : null}
      {vm.notes.length > 0 ? (
        <ul className="t-meta m-0 list-disc pl-5" data-testid="st-notes">
          {vm.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      {vm.lines.length > 0 ? (
        <div className="glass min-w-0 overflow-x-auto p-2" data-testid="st-table">
          <table className="w-full min-w-[620px] border-collapse text-left text-[14px]">
            <caption className="sr-only">Buys and sells, in shares</caption>
            <thead>
              <tr className="text-fg3">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Token</th>
                <th className="px-3 py-2 text-right font-medium">Shares</th>
                <th className="px-3 py-2 text-right font-medium">Price per share</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
                <th className="px-3 py-2 text-right font-medium">Realized</th>
              </tr>
            </thead>
            <tbody>
              {vm.lines.map((l, i) => (
                <tr key={l.txHash ?? i} className="border-t border-white/[0.06]">
                  <td className="px-3 py-2">{l.date.slice(0, 10)}</td>
                  <td className="px-3 py-2">{l.type === "BUY" ? "Buy" : "Sell"}</td>
                  <td className="px-3 py-2">
                    <span className="font-bold">{l.ticker}</span>{" "}
                    <span className="text-[12.5px] font-light text-fg3">
                      {l.issuer ? ISSUER_LABEL[l.issuer] : ""}
                    </span>
                    {l.txHash ? (
                      <a
                        className="mono ml-2 text-[12.5px] text-blue"
                        href={`https://bscscan.com/tx/${l.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="View transaction on BscScan (opens in a new tab)"
                      >
                        {shortHash(l.txHash)}
                      </a>
                    ) : null}
                    {l.convertedAtTodaysRatio ? (
                      <span className="t-meta block">Converted at today&apos;s ratio</span>
                    ) : null}
                  </td>
                  <td className="num px-3 py-2 text-right">{sharesStr(l.amountShares)}</td>
                  <td className="num px-3 py-2 text-right">{usd(l.pricePerShareUsd)}</td>
                  <td className="num px-3 py-2 text-right">{usd(l.valueUsd)}</td>
                  <td className="num px-3 py-2 text-right">
                    {l.realizedPnlUsd !== undefined ? usd(l.realizedPnlUsd) : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
