import { proceedsMeetBuyMinimum } from "./state";

export type PollSaleResult =
  | { state: "confirmed"; usdtReceivedRaw: string; source: "chain" | "receipt"; fixture?: boolean }
  | {
      state: "underMinimum";
      usdtReceivedRaw: string;
      source: "chain" | "receipt";
      fixture?: boolean;
    }
  | { state: "failed" }
  | { state: "unrecognised" }
  | { state: "pending" }
  | { state: "timeout" };

/**
 * Polls the sale transaction status.
 * Queries the onchain /api/trade/sale-proceeds route first.
 * The receipts worker (/api/receipts) is an optional fallback.
 */
export async function fetchSaleStatus(
  saleHash: string,
  startMs: number,
  receiptsEnabled: boolean,
  fetchFn: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<PollSaleResult> {
  const isTimedOut = nowMs - startMs > 120_000;

  // 1. Query onchain sale proceeds directly
  try {
    const spRes = await fetchFn(`/api/trade/sale-proceeds?hash=${saleHash}`);
    if (spRes.ok) {
      const spData = await spRes.json();
      if (spData.state === "confirmed") {
        const raw = BigInt(spData.usdtReceivedRaw);
        if (proceedsMeetBuyMinimum(raw)) {
          return {
            state: "confirmed",
            usdtReceivedRaw: spData.usdtReceivedRaw,
            source: "chain",
            fixture: spData.fixture === true,
          };
        }
        return {
          state: "underMinimum",
          usdtReceivedRaw: spData.usdtReceivedRaw,
          source: "chain",
          fixture: spData.fixture === true,
        };
      }
      if (spData.state === "failed") {
        return { state: "failed" };
      }
      if (spData.state === "unrecognised") {
        return { state: "unrecognised" };
      }
      if (spData.state === "pending" && isTimedOut) {
        return { state: "timeout" };
      }
    } else if (isTimedOut) {
      return { state: "timeout" };
    }
  } catch {
    if (isTimedOut) {
      return { state: "timeout" };
    }
  }

  // 2. Optional receipts worker fallback
  if (receiptsEnabled) {
    try {
      const rRes = await fetchFn(`/api/receipts?hash=${saleHash}`);
      if (rRes.ok) {
        const rData = await rRes.json();
        if (rData.state === "reconciled" && rData.usdtReceivedRaw) {
          const raw = BigInt(rData.usdtReceivedRaw);
          if (proceedsMeetBuyMinimum(raw)) {
            return {
              state: "confirmed",
              usdtReceivedRaw: rData.usdtReceivedRaw,
              source: "receipt",
            };
          }
          return {
            state: "underMinimum",
            usdtReceivedRaw: rData.usdtReceivedRaw,
            source: "receipt",
          };
        } else if (rData.state === "failed") {
          return { state: "failed" };
        }
      }
    } catch {
      // Receipts worker is optional
    }
  }

  if (isTimedOut) {
    return { state: "timeout" };
  }

  return { state: "pending" };
}
