import { ModuleBoundary } from "../../components/module-boundary";
import { loadReceipt, loadReceipts, type ActivityVM, type ReceiptVM } from "./view-model";
export function ReceiptContent({ vm }: { vm: ReceiptVM }) {
  if (vm.state === "disabled") return null;
  return (
    <section aria-label="Receipt" className="min-w-0 break-all">
      <h2>{vm.ticker ?? "Transaction"} receipt</h2>
      <p>{vm.status ?? vm.state}</p>
      {vm.reason && <p>{vm.reason}</p>}
      <p>
        {vm.provenance}
        {vm.stale ? " · Last verification is stale" : ""}
      </p>
      <ol>
        {vm.ladder.map((stage) => (
          <li key={stage.stage}>
            {stage.stage}: {stage.shares ?? "Unavailable"} shares
            {stage.tokens && ` (${stage.tokens} tokens)`}
            <p>{stage.reason ?? stage.source}</p>
          </li>
        ))}
      </ol>
      {vm.signedMinimumShares && <p>Signed minimum: {vm.signedMinimumShares} shares</p>}
      <details>
        <summary>Evidence</summary>
        <p>Transaction: {vm.txHash}</p>
        <p>Block: {vm.evidence.block ?? "Pending"}</p>
        <p>
          Gas used / limit: {vm.evidence.gasUsed ?? "Unavailable"} /{" "}
          {vm.evidence.gasLimit ?? "Unavailable"}
        </p>
        <p>Guard: {vm.evidence.guard ?? "Unavailable"}</p>
        <p>Multiplier: {vm.evidence.multiplier ?? "Unavailable"}</p>
        <p>Observation: {vm.evidence.observationId ?? "Unavailable"}</p>
        <p>Log indices: {vm.evidence.logIndices.join(", ") || "None"}</p>
        {vm.evidence.notes.map((n, i) => (
          <p key={i}>{n}</p>
        ))}
        {vm.evidence.explorerUrl && <a href={vm.evidence.explorerUrl}>View on BscScan</a>}
      </details>
    </section>
  );
}
export function ActivityContent({ vm }: { vm: ActivityVM }) {
  if (vm.state === "disabled") return null;
  return (
    <section aria-label="Activity">
      <h2>Activity</h2>
      {vm.reason && <p>{vm.reason}</p>}
      <p>{vm.pendingCount} pending</p>
      {vm.stale && <p>Last verification is stale</p>}
      <ul>
        {vm.items.map((r) => (
          <li key={r.txHash}>
            <a href={`/receipt/${r.txHash}`}>
              {r.ticker ?? "Transaction"}: {r.status}
            </a>
            <p>{r.reason}</p>
          </li>
        ))}
      </ul>
      {vm.truncated && <p>Showing up to 1000 latest transactions.</p>}
    </section>
  );
}
export async function ReceiptsPlain({ txHash, wallet }: { txHash?: string; wallet?: string } = {}) {
  if (process.env.FEATURE_RECEIPTS !== "1") return null;
  const content = txHash ? (
    <ReceiptContent vm={await loadReceipt(txHash)} />
  ) : (
    <ActivityContent vm={await loadReceipts({ wallet })} />
  );
  return <ModuleBoundary module="receipts" fallback={content} load={async () => content} />;
}
