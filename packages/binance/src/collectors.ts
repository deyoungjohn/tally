import { z } from "zod";
import { BinanceClient } from "./client";
import { rwaTokensResponse } from "./schemas";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const decimal = z.string().regex(/^\d+(\.\d+)?([eE][-+]?\d+)?$/);
export const rwaPrice = z
  .object({
    binanceChainId: z.literal("56"),
    tokenContractAddress: address,
    platformId: z.string(),
    tokenPrice: decimal,
    referencePrice: decimal.nullish(),
    tokenPriceUpdatedAt: z.number().int().nonnegative(),
  })
  .passthrough();
export const rwaPricesResponse = z.array(rwaPrice);
export type RwaPrice = z.infer<typeof rwaPrice>;

/** Additive scheduled-data interface. Reuses the signed client's pacing, retries and error mapping. */
export class BinanceCollectors {
  constructor(private readonly client: BinanceClient) {}
  registry(platformId?: "ondo" | "bstock") {
    return this.client.get(
      "/api/v1/dex/market/rwa/tokens",
      { binanceChainId: "56", platformId },
      rwaTokensResponse,
    );
  }
  prices(addresses: readonly string[]): Promise<RwaPrice[]> {
    if (addresses.length === 0) return Promise.resolve([]);
    if (addresses.length > 100) throw new RangeError("rwa/price accepts at most 100 addresses");
    const validated = addresses.map((a) => address.parse(a));
    return this.client.get(
      "/api/v1/dex/market/rwa/price",
      {
        binanceChainId: "56",
        tokenContractAddresses: validated.join(","),
      },
      rwaPricesResponse,
    );
  }
}
