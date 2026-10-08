"use client";

import { MigrateReceiptView } from "@/components/trade/migrate-receipt-view";
import { buildMigrateReceipt } from "@/lib/migrate/receipt-vm";

const mockVm = buildMigrateReceipt(
  {
    hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    tokenSymbol: "NVDAB",
    isFixture: true,
    multiplier: "1000000000000000000",
    sellTokensSpent: "10000000000000000000", // 10 NVDAB
    sellUsdtReceived: "100000000000000000000", // 100 USDT
    blockNumber: 1000,
    gasUsed: 100000,
  },
  {
    hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    tokenSymbol: "NVDAon",
    isFixture: true,
    multiplier: "1000000000000000000",
    buyTokensReceived: "10000000000000000000", // 10 NVDAon
    buyUsdtSpent: "99000000000000000000", // 99 USDT
    blockNumber: 1005,
    gasUsed: 120000,
  }
);

export default function MigrateReceiptDev() {
  return (
    <div className="p-8">
      <MigrateReceiptView vm={mockVm} />
    </div>
  );
}
