"use client";

import { ExternalLink } from "lucide-react";
import { shortHash } from "@/lib/format";
import { tokenPair } from "@/lib/tickers";
import type { ActivityVM, ReceiptVM } from "@/modules/receipts/view-model";

const STATUS: Record<string, { label: string; cls: string }> = {
  RECONCILED: { label: "Verified", cls: "text-up" },
  RECONCILED_WITH_DIFFERENCE: { label: "Verified, differs from the quote", cls: "text-up" },
  PENDING: { label: "Pending", cls: "text-amber" },
  FAILED: { label: "Failed", cls: "text-red" },
  UNRECONCILED: { label: "Not reconciled yet", cls: "text-amber" },
};
const KIND: Record<string, string> = {
  swap: "Buy",
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
          {r.ticker ? <span className="font-normal text-fg2"> · {tokenPair(r.ticker)}</span> : null}
        </p>
        <p className={`text-[14.5px] font-semibold ${st.cls}`} data-testid="activity-status">
          {st.label}
        </p>
      </div>
      {r.reason ? <p className="t-meta mt-1">{r.reason}</p> : null}
      {r.comparisonTrust === "client-hint" ? (
        <p className="t-meta mt-1" data-testid="activity-reported">
          The quote in this receipt was reported by your browser, not verified.
        </p>
      ) : null}
      <p className="t-meta mt-1">{r.provenance}</p>
      {r.evidence.explorerUrl ? (
        <a
          className="btn btn-glassy mt-3 !h-9 !px-4 text-[14px]"
          href={r.evidence.explorerUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="View transaction on BscScan (opens in a new tab)"
        >
          <ExternalLink size={14} aria-hidden /> BscScan{" "}
          <span className="mono text-[12.5px] text-fg2">{shortHash(r.txHash)}</span>
        </a>
      ) : null}
    </li>
  );
}

export function ActivityVmView({ vm }: { vm: ActivityVM }) {
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
    </div>
  );
}
