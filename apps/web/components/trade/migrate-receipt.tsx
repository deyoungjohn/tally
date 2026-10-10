import { useEffect, useState } from "react";
import { Modal } from "@/components/motion/modal";
import { buildMigrateReceipt, MigrateReceiptVM } from "../../lib/migrate/receipt-vm";
import { PendingMigrate } from "../../lib/migrate/state";
import { MigrateReceiptView } from "./migrate-receipt-view";

export function MigrateReceiptModal({
  open,
  onClose,
  pm,
}: {
  open: boolean;
  onClose: () => void;
  pm: PendingMigrate;
}) {
  const [vm, setVm] = useState<MigrateReceiptVM | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load() {
      let sellTokensSpent, sellUsdtReceived, sellGasUsed, sellBlockNumber;
      let buyTokensReceived, buyUsdtSpent, buyGasUsed, buyBlockNumber;
      let sellGasUsd, buyGasUsd;

      if (pm.saleHash) {
        try {
          const res = await fetch(`/api/receipts?hash=${pm.saleHash}`);
          if (res.ok) {
            const data = await res.json();
            if (data.state === "reconciled") {
              sellTokensSpent = data.tokensSpent;
              sellUsdtReceived = data.usdtReceivedRaw;
            }
          }

          const txRes = await fetch(`/api/trade/tx-status?hash=${pm.saleHash}`);
          if (txRes.ok) {
            const txData = await txRes.json();
            sellBlockNumber = txData.blockNumber;
            sellGasUsed = txData.gasUsed;
            sellGasUsd = txData.gasUsd ?? undefined;
          }
        } catch {
          /* ignore */
        }
      }

      if (pm.buyHash) {
        try {
          const res = await fetch(`/api/trade/receipt?tx=${pm.buyHash}&ticker=${pm.ticker}`);
          if (res.ok) {
            const data = await res.json();
            if (data.status === "success" && data.fill) {
              buyTokensReceived = data.fill.tokensOut;
              buyUsdtSpent = data.fill.amountInUsdt;
            }
            buyBlockNumber = data.blockNumber;
            buyGasUsed = data.gasUsed;
            buyGasUsd = data.gasUsd;
          }
        } catch {
          /* ignore */
        }
      }

      if (cancelled) return;

      const fromSymbol = pm.from === "ondo" ? `${pm.ticker}on` : `${pm.ticker}B`;
      const toSymbol = pm.to === "ondo" ? `${pm.ticker}on` : `${pm.ticker}B`;

      setVm(
        buildMigrateReceipt(
          {
            hash: pm.saleHash || "",
            tokenSymbol: fromSymbol,
            // Only the server says a result is fixture data. A real transaction hash that happens to start with 0xf1 is not.
            isFixture: Boolean(pm.isFixture),
            multiplier: pm.sourceMultiplier,
            sellGuaranteedUsdt: pm.sellPlan?.guaranteedUsdt,
            sellTokensSpent,
            sellUsdtReceived,
            blockNumber: sellBlockNumber,
            gasUsed: sellGasUsed,
            gasUsd: sellGasUsd,
            plan: pm.sellPlan
              ? {
                  route: pm.sellPlan.route,
                  vendor: pm.sellPlan.vendor,
                  quoteTime: pm.sellPlan.quoteTime,
                  simulation: pm.sellPlan.simulation,
                }
              : undefined,
          },
          {
            hash: pm.buyHash || "",
            tokenSymbol: toSymbol,
            isFixture: Boolean(pm.isFixture),
            multiplier: pm.destMultiplier,
            buyMinShares: pm.buyPlan?.minShares,
            buyTokensReceived,
            buyUsdtSpent,
            blockNumber: buyBlockNumber,
            gasUsed: buyGasUsed,
            gasUsd: buyGasUsd,
            plan: pm.buyPlan
              ? {
                  route: pm.buyPlan.route,
                  vendor: pm.buyPlan.vendor,
                  quoteTime: pm.buyPlan.quoteTime,
                  simulation: pm.buyPlan.simulation,
                }
              : undefined,
          },
        ),
      );
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, pm]);

  if (!vm) return null;

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Migrate Receipt"
      className="max-w-[700px]"
    >
      <MigrateReceiptView vm={vm} />
    </Modal>
  );
}
