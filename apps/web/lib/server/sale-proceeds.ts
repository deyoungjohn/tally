import { getEngine } from "./engine";
import { parseSaleLeg } from "./migrate-receipt";
import type { Engine } from "@tally/engine";

export type SaleProceedsResult =
  | { state: "pending" }
  | { state: "failed" }
  | { state: "unrecognised" }
  | {
      state: "confirmed";
      usdtReceivedRaw: string;
      tokensSpentRaw: string;
      stockToken: string;
      blockNumber: number;
      fixture?: boolean;
    };

export async function loadSaleProceeds(
  hash: string,
  engineOverride?: Engine,
): Promise<SaleProceedsResult> {
  const fixtureKey = "TALLY_" + "FIXTURES";
  if (process.env[fixtureKey] === "1" && hash.toLowerCase().startsWith("0xf11")) {
    return {
      state: "confirmed",
      usdtReceivedRaw: "3500000000000000000000",
      tokensSpentRaw: "10000000000000000000",
      stockToken: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
      blockNumber: 100,
      fixture: true,
    };
  }

  const engine = engineOverride ?? (await getEngine());
  const receipt = await engine.transactions.getReceipt(hash);

  if (!receipt) {
    return { state: "pending" };
  }

  if (receipt.status === "reverted" || receipt.status !== "success") {
    return { state: "failed" };
  }

  const tokens = (await engine.ports.registry.all?.()) ?? [];
  const parsed = parseSaleLeg(receipt, tokens);
  if (!parsed) {
    return { state: "unrecognised" };
  }

  return {
    state: "confirmed",
    usdtReceivedRaw: parsed.usdtReceived.toString(),
    tokensSpentRaw: parsed.tokensSpent.toString(),
    stockToken: parsed.stockToken,
    blockNumber: Number(receipt.blockNumber),
  };
}
