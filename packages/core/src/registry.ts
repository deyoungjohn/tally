import type { Address, Issuer, MultiplierSource, RegistryToken } from "./types";

export const EXECUTABLE_ISSUERS: readonly Issuer[] = ["bstock", "ondo"];

export const MULTIPLIER_SOURCE: Record<Issuer, MultiplierSource> = {
  bstock: "onchain-uiMultiplier",
  xstocks: "onchain-multiplier",
  ondo: "api",
};

export interface RegistryRow {
  ticker: string;
  issuer: Issuer;
  address: string;
  symbol: string;
  decimals: number;
  assetType: number;
}

export function toRegistryToken(r: RegistryRow): RegistryToken {
  return {
    ticker: r.ticker.toUpperCase(),
    issuer: r.issuer,
    address: r.address.toLowerCase() as Address,
    symbol: r.symbol,
    decimals: r.decimals,
    assetType: r.assetType,
    multiplierSource: MULTIPLIER_SOURCE[r.issuer],
    executable: EXECUTABLE_ISSUERS.includes(r.issuer),
  };
}

/** In-memory registry. Token addresses only ever come from here, never from user input (anti-phishing, blueprint §7.2). */
export class Registry {
  private readonly byTicker = new Map<string, RegistryToken[]>();
  private readonly byAddress = new Map<string, RegistryToken>();

  constructor(tokens: RegistryToken[]) {
    for (const t of tokens) {
      if (this.byAddress.has(t.address)) continue; // first row wins; the same contract never appears twice
      this.byAddress.set(t.address, t);
      const list = this.byTicker.get(t.ticker) ?? [];
      list.push(t);
      this.byTicker.set(t.ticker, list);
    }
  }

  static fromRows(rows: RegistryRow[]): Registry {
    return new Registry(rows.map(toRegistryToken));
  }

  get size(): number {
    return this.byAddress.size;
  }

  tokensFor(ticker: string): RegistryToken[] {
    return [...(this.byTicker.get(ticker.toUpperCase()) ?? [])];
  }

  byAddr(address: string): RegistryToken | undefined {
    return this.byAddress.get(address.toLowerCase());
  }

  /** Every token of every ticker (the send list: any tokenized stock a wallet holds can be sent out). */
  all(): RegistryToken[] {
    return [...this.byAddress.values()];
  }

  tickers(): string[] {
    return [...this.byTicker.keys()].sort();
  }
}
