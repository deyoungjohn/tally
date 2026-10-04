import {
  inspectTicker,
  type Address,
  type EnginePorts,
  type RegistryToken,
  type ResolvedSource,
} from "@tally/core";
import type { TradeChain } from "./trade";

/** Same default coverage as the web picker; callers can inspect any registry ticker explicitly. */
export const SHARES_TICKERS = ["NVDA", "AAPL", "TSLA", "QQQ", "SPY", "NFLX"] as const;

export interface ShareHolding {
  ticker: string;
  symbol: string;
  issuer: RegistryToken["issuer"];
  address: Address;
  decimals: number;
  /** Raw token units, in `decimals`; null means the balance read failed, never zero. */
  balance: bigint | null;
  /** Shares and multiplier are always 1e18 fixed point. */
  shares: bigint | null;
  multiplier: bigint | null;
  source: ResolvedSource | null;
  degraded: boolean;
  reason: string | null;
}

export interface SharesReport {
  address: Address;
  /** Report assembly time; underlying facts retain the engine's cache/source rules. */
  asOf: string;
  tickers: readonly string[];
  rows: ShareHolding[];
  groups: { ticker: string; shares: bigint | null; reason: string | null }[];
  failed: { ticker: string; message: string }[];
  warnings: string[];
}

/** Read-only additive accessor. Does not change the web portfolio or its data contract. */
export async function sharesOf(
  ports: EnginePorts,
  chain: Pick<TradeChain, "erc20Balances">,
  address: Address,
  tickers: readonly string[] = SHARES_TICKERS,
  onWarn?: (message: string) => void,
): Promise<SharesReport> {
  const now = ports.now ?? Date.now;
  const rows: ShareHolding[] = [];
  const failed: SharesReport["failed"] = [];
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    onWarn?.(message);
  };
  const scope = [...new Set(tickers.map((ticker) => ticker.toUpperCase()))];
  for (const ticker of scope) {
    let tokens: RegistryToken[];
    try {
      tokens = await ports.registry.tokensFor(ticker);
      if (tokens.length === 0) throw new Error("No registry tokens for this ticker.");
    } catch {
      const message = "Registry unavailable; this ticker's tokens could not be enumerated.";
      failed.push({ ticker, message });
      warn(`${ticker}: ${message}`);
      continue;
    }
    const [inspection, balances] = await Promise.allSettled([
      inspectTicker(ports, ticker),
      chain.erc20Balances(
        address,
        tokens.map((t) => t.address),
      ),
    ]);
    if (inspection.status === "rejected") warn(`${ticker}: share facts unavailable.`);
    if (balances.status === "rejected") warn(`${ticker}: token balances unavailable.`);
    for (const [i, token] of tokens.entries()) {
      const fact =
        inspection.status === "fulfilled"
          ? inspection.value.find((t) => t.address.toLowerCase() === token.address.toLowerCase())
          : undefined;
      const raw = balances.status === "fulfilled" ? (balances.value[i] ?? null) : null;
      const rejected = fact?.bounds?.outcome === "fail";
      const resolved = rejected ? null : (fact?.multiplier ?? null);
      const multiplier = resolved?.value ?? null;
      const reasons: string[] = [];
      if (raw === null) reasons.push("Token balance unavailable.");
      if (multiplier === null)
        reasons.push(
          rejected
            ? `Ondo multiplier rejected: ${fact?.bounds?.detail ?? "sanity bounds failed"}.`
            : "No accepted share multiplier available; shares cannot be determined.",
        );
      if (resolved?.degraded)
        reasons.push(`Preferred multiplier source unavailable; using ${resolved.source}.`);
      if (reasons.length) warn(`${token.symbol}: ${reasons.join(" ")}`);
      rows.push({
        ticker,
        symbol: token.symbol,
        issuer: token.issuer,
        address: token.address,
        decimals: token.decimals,
        balance: raw,
        multiplier,
        shares:
          raw === null || multiplier === null
            ? null
            : (raw * multiplier) / 10n ** BigInt(token.decimals),
        source: resolved?.source ?? null,
        degraded: resolved?.degraded ?? false,
        reason: reasons.length ? reasons.join(" ") : null,
      });
    }
  }
  const groups = scope.map((ticker) => {
    const parts = rows.filter((row) => row.ticker === ticker);
    const unknown = parts.length === 0 || parts.some((row) => row.shares === null);
    return {
      ticker,
      shares: unknown ? null : parts.reduce((sum, row) => sum + row.shares!, 0n),
      reason: unknown
        ? "Total shares unknown: one or more issuer balances or multipliers are unavailable."
        : null,
    };
  });
  return {
    address,
    asOf: new Date(now()).toISOString(),
    tickers: scope,
    rows,
    groups,
    failed,
    warnings,
  };
}
