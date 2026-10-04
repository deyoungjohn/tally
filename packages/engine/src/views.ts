import { TtlCache, inspectTicker, type EnginePorts, type TokenInspection } from "@tally/core";
import type { Address } from "@tally/core";
import type { TradeChain } from "./trade";

const E18 = 1e18;

export interface RadarRow {
  ticker: string;
  symbol: string;
  issuer: "ondo" | "bstock" | "xstocks";
  address: Address;
  executable: boolean;
  /** Plain-English reason when the token is not buyable. */
  reason?: string;
  /** Shares per token. */
  multiplier?: number;
  grade: "A" | "B" | "C" | "D" | "F";
  flags: string[];
  /** Deductions and flags in plain English. */
  reasons: string[];
  volume24hUsd?: number;
  status?: string;
  unitTrap: boolean;
}

export interface RadarReport {
  asOf: string;
  rows: RadarRow[];
  /** Tickers whose data could not be read, with why. Never silently dropped. */
  failed: { ticker: string; message: string }[];
}

const toRow = (ticker: string, t: TokenInspection): RadarRow => ({
  ticker,
  symbol: t.symbol,
  issuer: t.issuer,
  address: t.address,
  executable: t.executable,
  reason: t.blockedReason,
  multiplier: t.multiplier ? Number(t.multiplier.value) / E18 : undefined,
  grade: t.integrity.grade,
  flags: t.integrity.flags,
  reasons: t.integrity.reasons.map((r) => r.reason ?? r.summary),
  volume24hUsd: t.facts.onchainVolume24hUsd,
  status: t.facts.status?.kind,
  unitTrap: t.integrity.unitTrap,
});

/** Trap radar: every token of the given tickers with its integrity grade (blueprint §7.5). One ticker at a time, to respect the API's pacing. */
export function radarFor(ports: EnginePorts, now: () => number, ttlMs = 120_000) {
  const cache = new TtlCache<RadarReport>(ttlMs, now);
  return (tickers: readonly string[]) =>
    cache.get(tickers.join(","), async () => {
      const rows: RadarRow[] = [];
      const failed: RadarReport["failed"] = [];
      for (const t of tickers) {
        try {
          for (const tok of await inspectTicker(ports, t)) rows.push(toRow(t, tok));
        } catch (e) {
          failed.push({
            ticker: t,
            message: e instanceof Error ? e.message.slice(0, 160) : String(e),
          });
        }
      }
      return { asOf: new Date(now()).toISOString(), rows, failed };
    });
}

export interface Holding {
  ticker: string;
  symbol: string;
  issuer: "ondo" | "bstock" | "xstocks";
  address: Address;
  /** Token units held. */
  tokens: number;
  /** Shares per token. */
  multiplier: number;
  /** tokens × multiplier: the number that matters. */
  shares: number;
  valueUsd: number | null;
  grade: RadarRow["grade"];
}

export interface PortfolioReport {
  address: Address;
  asOf: string;
  /** Holdings across issuers, grouped by ticker (shares add up across issuers). */
  groups: {
    ticker: string;
    shares: number;
    valueUsd: number | null;
    referencePrice: number | null;
    parts: Holding[];
  }[];
  totalValueUsd: number;
  wallet: { usdt: number; bnb: number };
  failed: { ticker: string; message: string }[];
}

/** Portfolio in shares (blueprint §11): balanceOf for every registry token of the given tickers × its resolved multiplier. */
export async function portfolioFor(
  ports: EnginePorts,
  chain: TradeChain,
  address: Address,
  tickers: readonly string[],
  now: () => number,
): Promise<PortfolioReport> {
  const failed: PortfolioReport["failed"] = [];
  const groups: PortfolioReport["groups"] = [];
  const [bal] = await Promise.all([chain.balances(address)]);
  for (const ticker of tickers) {
    try {
      const toks = await inspectTicker(ports, ticker);
      const balances = await chain.erc20Balances(
        address,
        toks.map((t) => t.address),
      );
      const ref = toks[0]?.referencePrice?.price ?? null;
      const parts: Holding[] = [];
      toks.forEach((t, i) => {
        const raw = balances[i] ?? 0n;
        if (raw === 0n || !t.multiplier) return;
        const tokens = Number(raw) / E18;
        const multiplier = Number(t.multiplier.value) / E18;
        const shares = tokens * multiplier;
        parts.push({
          ticker,
          symbol: t.symbol,
          issuer: t.issuer,
          address: t.address,
          tokens,
          multiplier,
          shares,
          valueUsd: ref === null ? null : shares * ref,
          grade: t.integrity.grade,
        });
      });
      if (parts.length === 0) continue;
      const shares = parts.reduce((a, p) => a + p.shares, 0);
      groups.push({
        ticker,
        shares,
        valueUsd: ref === null ? null : shares * ref,
        referencePrice: ref,
        parts,
      });
    } catch (e) {
      failed.push({ ticker, message: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }
  return {
    address,
    asOf: new Date(now()).toISOString(),
    groups,
    totalValueUsd: groups.reduce((a, g) => a + (g.valueUsd ?? 0), 0),
    wallet: { usdt: Number(bal.usdt) / E18, bnb: Number(bal.bnb) / E18 },
    failed,
  };
}
