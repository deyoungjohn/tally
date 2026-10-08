import { getEngine } from "./engine";
import { decodeTransfer } from "@tally/mod-receipts/src/decode";
import { USDT_BSC } from "@tally/config";
import { buildMigrateReceipt, MigrateReceiptVM } from "../migrate/receipt-vm";

export type MigratePageResult =
  | { state: "ready"; vm: MigrateReceiptVM }
  | { state: "not_a_migrate"; sellHash: string; buyHash: string };

export async function loadMigrateReceipt(
  sellHash: string,
  buyHash: string,
): Promise<MigratePageResult> {
  const engine = await getEngine();

  if (!/^0x[0-9a-fA-F]{64}$/.test(sellHash) || !/^0x[0-9a-fA-F]{64}$/.test(buyHash)) {
    return { state: "not_a_migrate", sellHash, buyHash };
  }

  const sellReceipt = await engine.transactions.getReceipt(sellHash);
  const buyReceipt = await engine.trade.receipt(buyHash as `0x${string}`, undefined);

  if (!sellReceipt || !buyReceipt) return { state: "not_a_migrate", sellHash, buyHash };
  if (sellReceipt.status !== "success" || buyReceipt.status !== "success")
    return { state: "not_a_migrate", sellHash, buyHash };

  const sender = sellReceipt.sender.toLowerCase();
  if (buyReceipt.fill && sender !== buyReceipt.fill.user.toLowerCase())
    return { state: "not_a_migrate", sellHash, buyHash };

  if (sellReceipt.blockNumber > BigInt(buyReceipt.blockNumber ?? 0))
    return { state: "not_a_migrate", sellHash, buyHash };

  // Parse Sell Leg
  let sellUsdtReceived = 0n;
  let sellStockToken = "";
  let sellTokensSpent = 0n;

  for (const log of sellReceipt.logs) {
    const decoded = decodeTransfer(log);
    if (!decoded.ok) continue;

    const t = decoded.value;
    if (log.address.toLowerCase() === USDT_BSC.toLowerCase()) {
      if (t.to.toLowerCase() === sender) {
        sellUsdtReceived += t.value;
      }
    } else {
      if (t.from.toLowerCase() === sender) {
        // This must be the stock token
        sellStockToken = log.address.toLowerCase();
        sellTokensSpent += t.value;
      }
    }
  }

  // Parse Buy Leg
  const fill = buyReceipt.fill;
  if (!fill) return { state: "not_a_migrate", sellHash, buyHash };

  const buyUsdtSpent = BigInt(fill.amountInUsdt);
  const buyStockToken = fill.stock.toLowerCase();

  if (sellUsdtReceived < buyUsdtSpent) return { state: "not_a_migrate", sellHash, buyHash };

  // They must be different issuers but same ticker
  const tokens = (await engine.ports.registry.all?.()) ?? [];
  const sellDef = tokens.find(
    (t: { address: string; ticker: string; issuer: string }) =>
      t.address.toLowerCase() === sellStockToken,
  );
  const buyDef = tokens.find(
    (t: { address: string; ticker: string; issuer: string }) =>
      t.address.toLowerCase() === buyStockToken,
  );

  if (!sellDef || !buyDef) return { state: "not_a_migrate", sellHash, buyHash };
  if (sellDef.ticker !== buyDef.ticker || sellDef.issuer === buyDef.issuer)
    return { state: "not_a_migrate", sellHash, buyHash };

  const sellSymbol = sellDef.issuer === "ondo" ? `${sellDef.ticker}on` : `${sellDef.ticker}B`;
  const buySymbol = buyDef.issuer === "ondo" ? `${buyDef.ticker}on` : `${buyDef.ticker}B`;

  let sellMultiplier: string | undefined;
  try {
    const facts = await engine.ports.facts.multipliers(sellDef);
    sellMultiplier = (facts.api ?? facts.list ?? facts.onchain)?.toString();
  } catch {
    /* ignore */
  }

  const vm = buildMigrateReceipt(
    {
      hash: sellHash,
      tokenSymbol: sellSymbol,
      isFixture: sellHash.startsWith("0xf1"),
      multiplier: sellMultiplier,
      sellTokensSpent: sellTokensSpent.toString(),
      sellUsdtReceived: sellUsdtReceived.toString(),
      blockNumber: Number(sellReceipt.blockNumber),
      gasUsed: Number(sellReceipt.gasUsed),
      // we don't have feeUsd, quote details for permalink
    },
    {
      hash: buyHash,
      tokenSymbol: buySymbol,
      isFixture: buyHash.startsWith("0xf1"),
      multiplier: fill.multiplier,
      buyTokensReceived: fill.tokensOut,
      buyUsdtSpent: fill.amountInUsdt,
      blockNumber: buyReceipt.blockNumber,
      gasUsed: buyReceipt.gasUsed,
      gasUsd: buyReceipt.gasUsd ?? undefined,
    },
  );

  return { state: "ready", vm };
}
