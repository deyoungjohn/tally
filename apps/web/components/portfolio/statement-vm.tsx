"use client";

import { useState } from "react";
import { TokenIcon } from "@/components/ui/token-icon";
import { Download } from "lucide-react";
import { Button } from "@/components/motion/button";
import { tokenSymbol } from "@/lib/tickers";
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

/** In this table an unknown value is a dash, not the word. */
const dash = (s: string) => (s === "unknown" ? "-" : s);

/** A token in the wallet that the statement feed has no record of (received from another wallet, or bought outside Tally). */
export interface UntrackedToken {
  key: string;
  symbol: string;
  ticker: string;
  issuer: "ondo" | "bstock" | "xstocks";
  address: string;
  shares: string;
  tokens: number;
  sharesPerToken: number;
  valueUsd: string;
}

/** One dated incoming transfer from `/api/transfers`. */
export interface ReceivedRow {
  token: string;
  from: string;
  tokens: string;
  date: string;
  txHash: string;
}

export function StatementVmView({
  vm,
  valueToday,
  recent = [],
  untracked = [],
  received = [],
  wallet,
}: {
  vm: StatementVM;
  /** The wallet's value right now, counting every tokenized stock (the same total the Portfolio card shows). */
  valueToday?: string;
  /** Verified transactions the feed does not have yet, from Activity. */
  recent?: StatementVM["lines"];
  untracked?: UntrackedToken[];
  /** Dated transfers into the wallet (last 90 days). A token with none keeps one undated row. */
  received?: ReceivedRow[];
  wallet?: string | null;
}) {
  // The table lists tokenized stocks only. A line with no issuer is not one (for example BNB or USDT moving as part of a swap).
  const lines = [...recent, ...vm.lines].filter((l) => l.issuer !== null);
  const anyRealized = vm.lines.some((l) => l.realizedPnlUsd !== undefined);

  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const { downloadStatementPdf } = await import("./statement-pdf");
      await downloadStatementPdf(vm);
    } catch (err) {
      const message = err instanceof Error ? err.message : "PDF generation failed";
      setPdfError(`Could not generate PDF: ${message}. Please try downloading CSV.`);
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 min-w-0 gap-4" data-testid="vm-statement">
      <section className="glass min-w-0 p-5" aria-label="Statement totals">
        <dl>
          <div className="detail-row">
            <dt>Value today</dt>
            <dd data-testid="st-value">{dash(usd(valueToday ?? vm.totalValueUsd))}</dd>
          </div>
          <div className="detail-row">
            <dt>Cost basis</dt>
            <dd data-testid="st-cost">{dash(usd(vm.totalCostBasisUsd))}</dd>
          </div>
          {untracked.length === 0 ? (
            <div className="detail-row">
              <dt>Unrealized PnL</dt>
              <dd className={signed(vm.totalUnrealizedPnlUsd)} data-testid="st-unrealized">
                {dash(usd(vm.totalUnrealizedPnlUsd))}
              </dd>
            </div>
          ) : null}
          <div className="detail-row">
            <dt>Realized PnL</dt>
            <dd className={signed(vm.totalRealizedPnlUsd)} data-testid="st-realized">
              {anyRealized ? dash(usd(vm.totalRealizedPnlUsd)) : "-"}
            </dd>
          </div>
        </dl>
        {untracked.length > 0 ? (
          <p className="t-meta mt-2" data-testid="st-untracked-note">
            {untracked.length === 1 ? "1 token has" : `${untracked.length} tokens have`} no trade
            record (received from another wallet, or bought outside Tally). They are counted in
            Value today and listed below as received; their cost is unknown, so the unrealized
            figure is left out.
          </p>
        ) : null}
        {anyRealized ? null : (
          <p className="t-meta mt-2" data-testid="st-realized-reason">
            No sale in this statement could be matched to a cost, so no realized figure is shown.
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="glassy" onClick={() => downloadCsv(vm)} data-testid="st-csv">
            <Download size={16} aria-hidden /> Download statement CSV
          </Button>
          <Button
            variant="glassy"
            onClick={handleDownloadPdf}
            disabled={pdfLoading}
            data-testid="st-pdf"
          >
            <Download size={16} aria-hidden />{" "}
            {pdfLoading ? "Generating PDF..." : "Download statement PDF"}
          </Button>
        </div>
        {pdfError ? (
          <p role="alert" className="t-meta mt-2 text-amber" data-testid="st-pdf-error">
            {pdfError}
          </p>
        ) : null}
      </section>

      {vm.differsFromApiNote ? (
        <p
          role="note"
          className="t-meta break-words text-amber [overflow-wrap:anywhere]"
          data-testid="st-differs"
        >
          {vm.differsFromApiNote}
        </p>
      ) : null}
      {vm.convertedAtTodaysRatioNote ? (
        <p
          role="note"
          className="t-meta break-words [overflow-wrap:anywhere]"
          data-testid="st-converted"
        >
          {vm.convertedAtTodaysRatioNote}
        </p>
      ) : null}
      {vm.notes.length > 0 ? (
        <ul
          className="t-meta m-0 list-disc break-words pl-5 [overflow-wrap:anywhere]"
          data-testid="st-notes"
        >
          {vm.notes.map((n) => (
            <li key={n} className="break-words [overflow-wrap:anywhere]">
              {n}
            </li>
          ))}
        </ul>
      ) : null}

      {lines.length > 0 || untracked.length > 0 ? (
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
              {lines.map((l, i) => (
                <tr key={l.txHash ?? i} className="border-t border-white/[0.06]">
                  <td className="px-3 py-2">{l.date.slice(0, 10)}</td>
                  <td className="px-3 py-2">{l.type === "BUY" ? "Purchase" : "Sale"}</td>
                  <td className="px-3 py-2">
                    {(() => {
                      const symbol = l.issuer ? tokenSymbol(l.ticker, l.issuer) : l.ticker;
                      const icon = l.issuer ? (
                        <TokenIcon ticker={l.ticker} size={20} className="mr-2" />
                      ) : null;
                      const name = l.txHash ? (
                        <a
                          className="font-bold link-text"
                          href={`https://bscscan.com/tx/${l.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`${symbol}: view transaction on BscScan (opens in a new tab)`}
                        >
                          {symbol}
                        </a>
                      ) : (
                        <span className="font-bold">{symbol}</span>
                      );
                      return (
                        <span className="inline-flex items-center">
                          {icon}
                          {name}
                        </span>
                      );
                    })()}
                    {l.convertedAtTodaysRatio ? (
                      <span className="t-meta block">Converted at today&apos;s ratio</span>
                    ) : null}
                  </td>
                  <td className="num px-3 py-2 text-right">{dash(sharesStr(l.amountShares))}</td>
                  <td className="num px-3 py-2 text-right">{dash(usd(l.pricePerShareUsd))}</td>
                  <td className="num px-3 py-2 text-right">{dash(usd(l.valueUsd))}</td>
                  <td className="num px-3 py-2 text-right">
                    {l.realizedPnlUsd !== undefined ? usd(l.realizedPnlUsd) : "–"}
                  </td>
                </tr>
              ))}
              {untracked.flatMap((t) => {
                const dated = received.filter(
                  (r) => r.token.toLowerCase() === t.address.toLowerCase(),
                );
                const token = (
                  <span className="inline-flex items-center">
                    <TokenIcon ticker={t.ticker} size={20} className="mr-2" />
                    <a
                      className="link-text font-bold"
                      href={`https://bscscan.com/token/${t.address}${wallet ? `?a=${wallet}` : ""}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${t.symbol}: view on BscScan (opens in a new tab)`}
                    >
                      {t.symbol}
                    </a>
                  </span>
                );
                if (dated.length === 0)
                  return [
                    <tr
                      key={t.key}
                      className="border-t border-white/[0.06]"
                      data-testid={`st-received-${t.symbol}`}
                    >
                      <td className="px-3 py-2">–</td>
                      <td className="px-3 py-2">Received</td>
                      <td className="px-3 py-2">{token}</td>
                      <td className="num px-3 py-2 text-right">{t.shares}</td>
                      <td className="num px-3 py-2 text-right">-</td>
                      <td className="num px-3 py-2 text-right">${t.valueUsd}</td>
                      <td className="num px-3 py-2 text-right">–</td>
                    </tr>,
                  ];
                return dated.map((r) => (
                  <tr
                    key={`${t.key}-${r.txHash}-${r.tokens}`}
                    className="border-t border-white/[0.06]"
                    data-testid={`st-received-${t.symbol}`}
                  >
                    <td className="px-3 py-2">{r.date.slice(0, 10)}</td>
                    <td className="px-3 py-2">Received</td>
                    <td className="px-3 py-2">
                      {token}
                      <a
                        className="link-text t-meta block"
                        href={`https://bscscan.com/tx/${r.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${t.symbol}: view transfer on BscScan (opens in a new tab)`}
                      >
                        from {r.from.slice(0, 6)}…{r.from.slice(-4)}
                      </a>
                    </td>
                    <td className="num px-3 py-2 text-right">
                      {String(Number((Number(r.tokens) * t.sharesPerToken).toFixed(6)))}
                    </td>
                    <td className="num px-3 py-2 text-right">-</td>
                    <td className="num px-3 py-2 text-right">–</td>
                    <td className="num px-3 py-2 text-right">–</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
