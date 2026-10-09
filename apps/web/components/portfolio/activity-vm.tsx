"use client";

import { ExternalLink, FileText } from "lucide-react";
import Link from "next/link";
import { useModuleFlags } from "@/lib/hooks/use-flags";
import { tokenPair, tokenSymbol } from "@/lib/tickers";
import type { ActivityVM, ReceiptVM } from "@/modules/receipts/view-model";

const STATUS: Record<string, { label: string; cls: string }> = {
  RECONCILED: { label: "Verified", cls: "text-up" },
  RECONCILED_WITH_DIFFERENCE: { label: "Verified", cls: "text-up" },
  PENDING: { label: "Pending", cls: "text-amber" },
  FAILED: { label: "Failed", cls: "text-red" },
  UNRECONCILED: { label: "Not reconciled yet", cls: "text-amber" },
};
const KIND: Record<string, string> = {
  swap: "Purchase",
  sell: "Sale",
  approval: "USDT approval",
  stock_approval: "Token approval",
};

function Item({ r }: { r: ReceiptVM }) {
  const st = STATUS[r.status ?? "PENDING"] ?? STATUS.PENDING!;
  return (
    <li className="panel list-none p-4" data-testid={`activity-${r.txHash}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="font-semibold">
          {r.kind ? (KIND[r.kind] ?? "Transaction") : "Transaction"}
          {r.ticker ? (
            <span className="font-normal text-fg2">
              {" "}
              · {r.symbol ?? (r.issuer ? tokenSymbol(r.ticker, r.issuer) : tokenPair(r.ticker))}
            </span>
          ) : null}
        </p>
        <p className={`text-[14.5px] font-semibold ${st.cls}`} data-testid="activity-status">
          {st.label}
        </p>
      </div>
      {r.status === "RECONCILED" || r.status === "RECONCILED_WITH_DIFFERENCE" ? (
        <p className="t-meta mt-1" data-testid="activity-verified-note">
          Verified means the chain confirms this transaction and the amount you received.
        </p>
      ) : null}
      {r.reason ? <p className="t-meta mt-1">{r.reason}</p> : null}
      {r.comparisonTrust === "client-hint" ? (
        <p className="t-meta mt-1" data-testid="activity-reported">
          The quote in this receipt was reported by your browser.
        </p>
      ) : null}
      <p className="t-meta mt-1">{r.provenance}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/receipt/${r.txHash}`}
          className="btn btn-glassy !h-9 !px-4 text-[14px]"
          data-testid={`activity-receipt-${r.txHash}`}
        >
          <FileText size={14} aria-hidden /> Receipt
        </Link>
        {r.evidence.explorerUrl ? (
          <a
            className="btn btn-glassy !h-9 !px-4 text-[14px]"
            href={r.evidence.explorerUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="View transaction on BscScan (opens in a new tab)"
          >
            <ExternalLink size={14} aria-hidden /> BscScan
          </a>
        ) : null}
      </div>
    </li>
  );
}

export function ActivityVmView({ vm }: { vm: ActivityVM }) {
  const flags = useModuleFlags();
  return (
    <div className="grid gap-3" data-testid="vm-activity">
      {vm.pendingCount > 0 ? (
        <p className="t-meta" role="status" data-testid="activity-pending">
          {vm.pendingCount} pending
        </p>
      ) : null}
      <ul className="m-0 grid list-none gap-3 p-0">
        {vm.items.map((r) => (
          <Item key={r.txHash} r={r} />
        ))}
      </ul>
      {vm.truncated ? <p className="t-meta">Showing up to 1000 latest transactions.</p> : null}
      {flags.quality ? (
        <Link href="/quality" className="inline-flex min-h-[44px] items-center link-text">
          How Tally&apos;s fills compare with their quotes
        </Link>
      ) : null}
    </div>
  );
}
