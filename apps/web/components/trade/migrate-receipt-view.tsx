import { CheckCircle2 } from "lucide-react";
import { LegVM, MigrateReceiptVM } from "../../lib/migrate/receipt-vm";
import { Tip } from "@/components/ui/tooltip";
import { dec3, dec3Down, usdt2, usdt2Down } from "@/lib/receipt-format";
import { fmtUsd } from "@/lib/format";
import { ShareReceiptButton } from "./share-receipt-button";

const NOT_RECORDED = "Not recorded on chain";

/** One label/value line; a value that was not recorded on chain is left out for good, never shown as "not recorded". */
function Row({
  label,
  value,
  tip,
}: {
  label: React.ReactNode;
  value: React.ReactNode | null | undefined;
  tip?: string;
}) {
  if (value === null || value === undefined || value === "" || value === NOT_RECORDED) return null;
  return (
    <div className="flex min-w-0 justify-between gap-3">
      <span className="shrink-0 text-white/60">{tip ? <Tip text={tip}>{label}</Tip> : label}</span>
      <span className="min-w-0 break-all text-right">{value}</span>
    </div>
  );
}

function Leg({
  leg,
  title,
  unit,
  receiptLabel,
  protectionDelivered,
}: {
  leg: LegVM;
  title: string;
  unit: "USDT" | "shares";
  receiptLabel: string;
  protectionDelivered: string | null;
}) {
  const pending = (v: string | null) => v ?? (leg.verified ? null : "Pending");
  const quoteTime = leg.quoteTime ? new Date(leg.quoteTime).toISOString() : null;
  const guaranteed = leg.protectionValue
    ? `${(unit === "USDT" ? usdt2Down : dec3Down)(leg.protectionValue)} ${unit}`
    : null;
  const delivered = protectionDelivered
    ? `${(unit === "USDT" ? usdt2 : dec3)(protectionDelivered)} ${unit}`
    : null;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h4 className="font-semibold pb-2 border-b border-white/15">{title}</h4>

      <div className="grid gap-y-2 text-sm">
        <Row label="Token" value={leg.tokenSymbol} />
        <Row
          label="Amount"
          value={
            <>
              {leg.verified ? dec3(leg.tokenAmount) : "Pending"}
              {leg.verified ? (
                <span className="mt-1 block text-xs">
                  <span className="rounded bg-white/10 px-1">Verified</span>
                </span>
              ) : null}
            </>
          }
        />
        <Row
          label={leg.sharesLabel ?? "Shares"}
          value={leg.shares ? dec3(leg.shares) : pending(null)}
          tip={leg.sharesAtTodaysMultiplier ? "Calculated at the current multiplier" : undefined}
        />
        <Row label="Value (USDT)" value={leg.usdValue ? usdt2(leg.usdValue) : pending(null)} />
      </div>

      {guaranteed || delivered ? (
        <div className="bg-white/5 rounded p-3 text-xs grid gap-2">
          <div className="font-medium mb-1">Protection</div>
          <Row label={leg.protectionLabel} value={guaranteed} />
          <Row
            label="Delivered"
            value={
              delivered ? (
                <span className="inline-flex items-center gap-1">
                  {delivered}
                  {leg.protectionPass && <CheckCircle2 className="w-3 h-3 shrink-0 text-white" />}
                </span>
              ) : null
            }
          />
        </div>
      ) : null}

      <div className="text-xs grid gap-y-1">
        <div className="font-medium mb-1">Execution</div>
        <Row label="Route" value={leg.route} />
        <Row label="Vendor" value={leg.vendor} />
        <Row label="Quote time" value={quoteTime} />
        <Row label="Value" value="0 BNB" />
        <Row
          label="Gas used"
          value={
            leg.gasUsed === null
              ? pending(null)
              : `${leg.gasUsed.toLocaleString("en-US")}${leg.gasUsd !== null ? ` (≈ ${fmtUsd(leg.gasUsd, 3)})` : ""}`
          }
        />
        <Row
          label="Block"
          value={pending(leg.blockNumber === null ? null : String(leg.blockNumber))}
        />
      </div>

      <div className="mt-auto pt-2 border-t border-white/15 flex gap-2">
        <a
          href={`/receipt/${leg.txHash}`}
          target="_blank"
          rel="noreferrer"
          className="link-text text-xs"
        >
          {receiptLabel}
        </a>
        <a
          href={`https://bscscan.com/tx/${leg.txHash}`}
          target="_blank"
          rel="noreferrer"
          className="link-text text-xs"
        >
          BscScan
        </a>
      </div>
    </div>
  );
}

export function MigrateReceiptView({ vm }: { vm: MigrateReceiptVM }) {
  return (
    <div className="grid grid-cols-1 min-w-0 gap-6 mt-4 text-sm text-white bg-transparent">
      {vm.isFixture && <div className="text-[var(--orange-text)] font-medium">Fixture data</div>}

      <div className="flex flex-col gap-1 pb-4 border-b border-white/15">
        <h3 className="font-semibold text-base mb-2">How they compare in shares:</h3>
        {vm.shareDiff ? (
          <>
            <p className="text-white/60">{vm.shareDiff.label}</p>
            <div className="flex flex-wrap gap-x-8 gap-y-1 mt-2 font-medium break-all">
              <div>
                <span className="text-white/60 mr-2">
                  Share difference{vm.shareDiff.approximate ? " (approximate)" : ""}:
                </span>
                <span className={vm.shareDiff.isDown ? "text-[var(--orange-text)]" : ""}>
                  {vm.shareDiff.diff}
                </span>
              </div>
              {vm.dollarDiff && (
                <div>
                  <span className="text-white/60 mr-2">Dollar difference:</span>
                  <span className={vm.dollarDiff.isDown ? "text-[var(--orange-text)]" : ""}>
                    {vm.dollarDiff.diff}
                  </span>
                </div>
              )}
            </div>
          </>
        ) : vm.giveUp.verified && vm.receive.verified ? null : (
          <p className="text-white/60">Pending verification...</p>
        )}
      </div>

      <div className="grid grid-cols-1 min-w-0 md:grid-cols-2 gap-8">
        <Leg
          leg={vm.giveUp}
          title="Step 1: You gave up"
          unit="USDT"
          receiptLabel="Sale Receipt"
          protectionDelivered={vm.giveUp.usdValue}
        />
        <Leg
          leg={vm.receive}
          title="Step 2: You received"
          unit="shares"
          receiptLabel="Buy Receipt"
          protectionDelivered={vm.receive.shares}
        />
      </div>

      <ShareReceiptButton sellHash={vm.giveUp.txHash} buyHash={vm.receive.txHash} />
    </div>
  );
}
