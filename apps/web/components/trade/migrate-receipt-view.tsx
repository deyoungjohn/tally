import { CheckCircle2 } from "lucide-react";
import { MigrateReceiptVM } from "../../lib/migrate/receipt-vm";
import { ShareReceiptButton } from "./share-receipt-button";

export function MigrateReceiptView({ vm }: { vm: MigrateReceiptVM }) {
  return (
    <div className="grid gap-6 mt-4 text-sm text-white bg-transparent">
      {vm.isFixture && <div className="text-[var(--orange-text)] font-medium">Fixture data</div>}

      <div className="flex flex-col gap-1 pb-4 border-b border-white/15">
        <h3 className="font-semibold text-base mb-2">Share-true comparison</h3>
        {vm.shareDiff ? (
          <>
            <p className="text-white/60">{vm.shareDiff.label}</p>
            <div className="flex gap-8 mt-2 font-medium">
              <div>
                <span className="text-white/60 mr-2">Share difference:</span>
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
        ) : (vm.giveUp.verified && vm.receive.verified) ? null : (
          <p className="text-white/60">Pending verification...</p>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Leg 1 */}
        <div className="flex flex-col gap-4">
          <h4 className="font-semibold pb-2 border-b border-white/15">Step 1: You gave up</h4>

          <div className="grid grid-cols-2 gap-y-2">
            <div className="text-white/60">Token</div>
            <div>{vm.giveUp.tokenSymbol}</div>

            <div className="text-white/60">Amount</div>
            <div>
              {vm.giveUp.verified ? vm.giveUp.tokenAmount : "Pending"}
              {vm.giveUp.verified && (
                <span className="ml-2 text-xs bg-white/10 px-1 rounded">Verified</span>
              )}
            </div>

            <div className="text-white/60">Shares</div>
            <div>{vm.giveUp.shares ?? (vm.giveUp.verified ? "shares unavailable" : "Pending")}</div>

            <div className="text-white/60">Value (USDT)</div>
            <div>{vm.giveUp.usdValue ?? "Pending"}</div>
          </div>

          <div className="bg-white/5 rounded p-3 text-xs grid gap-2">
            <div className="font-medium mb-1">Protection</div>
            <div className="flex justify-between items-center">
              <span className="text-white/60">{vm.giveUp.protectionLabel}</span>
              <span>
                {vm.giveUp.protectionValue 
                  ? `${vm.giveUp.protectionValue} USDT` 
                  : (vm.giveUp.verified ? "Not recorded on chain" : "Pending")}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-white/60">Delivered</span>
              <div className="flex items-center gap-1">
                {vm.giveUp.usdValue 
                  ? `${vm.giveUp.usdValue} USDT` 
                  : (vm.giveUp.verified ? "Not recorded on chain" : "Pending")}
                {vm.giveUp.protectionPass && <CheckCircle2 className="w-3 h-3 text-white" />}
              </div>
            </div>
          </div>

          <div className="text-xs grid gap-y-1">
            <div className="font-medium mb-1">Execution</div>
            <div className="flex justify-between">
              <span className="text-white/60">Route</span>
              <span>{vm.giveUp.route}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Vendor</span>
              <span>{vm.giveUp.vendor}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Quote time</span>
              <span>
                {vm.giveUp.quoteTime
                  ? new Date(vm.giveUp.quoteTime).toISOString()
                  : "Not recorded on chain"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Simulated at gas limit</span>
              <span>
                {vm.giveUp.simulation === true
                  ? "yes"
                  : vm.giveUp.simulation === false
                    ? "no"
                    : "Not recorded"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Value</span>
              <span>0 BNB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Gas used</span>
              <span>{vm.giveUp.gasUsed ?? "Pending"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Block</span>
              <span>{vm.giveUp.blockNumber ?? "Pending"}</span>
            </div>
          </div>

          <div className="mt-auto pt-2 border-t border-white/15 flex gap-2">
            <a
              href={`/receipt/${vm.giveUp.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline hover:text-white/80"
            >
              Sale Receipt
            </a>
            <a
              href={`https://bscscan.com/tx/${vm.giveUp.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline hover:text-white/80"
            >
              BscScan
            </a>
          </div>
        </div>

        {/* Leg 2 */}
        <div className="flex flex-col gap-4">
          <h4 className="font-semibold pb-2 border-b border-white/15">Step 2: You received</h4>

          <div className="grid grid-cols-2 gap-y-2">
            <div className="text-white/60">Token</div>
            <div>{vm.receive.tokenSymbol}</div>

            <div className="text-white/60">Amount</div>
            <div>
              {vm.receive.verified ? vm.receive.tokenAmount : "Pending"}
              {vm.receive.verified && (
                <span className="ml-2 text-xs bg-white/10 px-1 rounded">Verified</span>
              )}
            </div>

            <div className="text-white/60">Shares</div>
            <div>{vm.receive.shares ?? (vm.receive.verified ? "shares unavailable" : "Pending")}</div>

            <div className="text-white/60">Value (USDT)</div>
            <div>{vm.receive.usdValue ?? "Pending"}</div>
          </div>

          <div className="bg-white/5 rounded p-3 text-xs grid gap-2">
            <div className="font-medium mb-1">Protection</div>
            <div className="flex justify-between items-center">
              <span className="text-white/60">{vm.receive.protectionLabel}</span>
              <span>
                {vm.receive.protectionValue 
                  ? `${vm.receive.protectionValue} shares` 
                  : (vm.receive.verified ? "Not recorded on chain" : "Pending")}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-white/60">Delivered</span>
              <div className="flex items-center gap-1">
                {vm.receive.shares 
                  ? `${vm.receive.shares} shares` 
                  : (vm.receive.verified ? "Not recorded on chain" : "Pending")}
                {vm.receive.protectionPass && <CheckCircle2 className="w-3 h-3 text-white" />}
              </div>
            </div>
          </div>

          <div className="text-xs grid gap-y-1">
            <div className="font-medium mb-1">Execution</div>
            <div className="flex justify-between">
              <span className="text-white/60">Route</span>
              <span>{vm.receive.route}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Vendor</span>
              <span>{vm.receive.vendor}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Quote time</span>
              <span>
                {vm.receive.quoteTime
                  ? new Date(vm.receive.quoteTime).toISOString()
                  : "Not recorded on chain"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Simulated at gas limit</span>
              <span>
                {vm.receive.simulation === true
                  ? "yes"
                  : vm.receive.simulation === false
                    ? "no"
                    : "Not recorded"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Value</span>
              <span>0 BNB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Gas used</span>
              <span>{vm.receive.gasUsed ?? "Pending"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Block</span>
              <span>{vm.receive.blockNumber ?? "Pending"}</span>
            </div>
          </div>

          <div className="mt-auto pt-2 border-t border-white/15 flex gap-2">
            <a
              href={`/receipt/${vm.receive.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline hover:text-white/80"
            >
              Buy Receipt
            </a>
            <a
              href={`https://bscscan.com/tx/${vm.receive.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline hover:text-white/80"
            >
              BscScan
            </a>
          </div>
        </div>
      </div>

      <ShareReceiptButton sellHash={vm.giveUp.txHash} buyHash={vm.receive.txHash} />
    </div>
  );
}
