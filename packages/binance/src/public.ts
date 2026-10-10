import { z } from "zod";
import { PUBLIC_LIST_TYPE } from "@tally/config";
import {
  publicEnvelope,
  publicListRow,
  rwaDynamic,
  tokenDynamic,
  type PublicListRow,
} from "./schemas";

const BAPI = "https://www.binance.com/bapi/defi";
const W3 = "https://web3.binance.com/bapi/defi";
const LIST = "public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai";
const RWA_DYNAMIC = "public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai";
const TOKEN_DYNAMIC = "public/wallet-direct/buw/wallet/market/token/dynamic/info/ai";
const HEADERS = {
  Accept: "application/json",
  "Accept-Encoding": "identity",
  "User-Agent": "binance-web3/1.1 (Skill)",
};

export type PublicIssuerType = keyof typeof PUBLIC_LIST_TYPE;

/** Undocumented, key-less endpoints (V15): used for the registry's full lists, cross-checks and onchain volume. Work from any region. */
export class PublicApi {
  constructor(private readonly f: typeof fetch = fetch) {}

  private async get<S extends z.ZodTypeAny>(url: string, schema: S): Promise<z.infer<S>> {
    const res = await this.f(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`public API returned non-JSON (HTTP ${res.status}) for ${url}`);
    }
    const env = publicEnvelope.safeParse(json);
    if (!env.success || String(env.data.code) !== "000000")
      throw new Error(`public API error for ${url}: ${text.slice(0, 160)}`);
    return schema.parse(env.data.data);
  }

  /** All tokens of one issuer across chains; callers filter to chain 56. */
  async list(issuer: PublicIssuerType): Promise<PublicListRow[]> {
    return this.get(`${BAPI}/v1/${LIST}?type=${PUBLIC_LIST_TYPE[issuer]}`, z.array(publicListRow));
  }

  async rwaDynamic(address: string) {
    return this.get(`${BAPI}/v2/${RWA_DYNAMIC}?chainId=56&contractAddress=${address}`, rwaDynamic);
  }

  async tokenDynamic(address: string) {
    return this.get(
      `${W3}/v4/${TOKEN_DYNAMIC}?chainId=56&contractAddress=${address}`,
      tokenDynamic,
    );
  }
}
