/** Test-only hints derived from the real F11 recorded quote, never fabricated realized data. */
import { recordedReceipt } from "./recorded";
import type { ReceiptHint } from "../hints";
export function recordedHint(name: "F11_NVDAB" | "F11_NVDAon" = "F11_NVDAB"): ReceiptHint {
  const r = recordedReceipt(name);
  return {
    version: 1,
    txHash: r.txHash!,
    intentId: r.intent.id,
    attempt: 1,
    user: r.intent.user,
    ticker: r.intent.ticker,
    isResumed: false,
    quote: {
      stock: r.intent.asset,
      issuer: name === "F11_NVDAB" ? "bstock" : "ondo",
      tokensOut: r.quote!.expectedOut.raw.toString(),
      multiplier: r.conversion!.multiplier.toString(),
      minShares: r.intent.minShares.toString(),
      amountInUsdt: r.intent.spend.raw.toString(),
      hops: r.quote!.route.length,
      routeText: r.quote!.route.join(" > "),
      builtAt: 0,
      expiresAt: 15_000,
    },
    simulation: null,
  };
}
