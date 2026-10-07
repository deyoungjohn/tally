import { E18, mulDiv, parseDecimal, toRegistryToken, type RegistryToken } from "@tally/core";
import type { SnapshotStore } from "@tally/modkit";
import { POSITION_MAX_AGE_MS } from "./decide";
import { positionKey } from "./shadow";
import type { PolicySettings, Position } from "./types";

/** Structural contract with registry/bsc; the authenticated list may be incomplete. */
export interface RegistryEntry {
  tokenContractAddress: string;
  underlyingTicker: string;
  platformId: string;
  tokenSymbol: string;
  decimals?: string | number | null;
  referencePrice?: string | null;
  tokenToShareRatio?: string | null;
  binanceChainId?: string;
}
export const REGISTRY_MAX_AGE_MS = 600_000;
export function registryToken(row: RegistryEntry): RegistryToken | null {
  const issuer = row.platformId?.toLowerCase();
  if (
    (issuer !== "ondo" && issuer !== "bstock" && issuer !== "xstocks") ||
    !/^0x[0-9a-fA-F]{40}$/.test(row.tokenContractAddress) ||
    !row.underlyingTicker ||
    (row.binanceChainId !== undefined && row.binanceChainId !== "56")
  )
    return null;
  return toRegistryToken({
    ticker: row.underlyingTicker,
    issuer,
    address: row.tokenContractAddress,
    symbol: row.tokenSymbol,
    decimals: row.decimals == null ? Number.NaN : Number(row.decimals),
    assetType: 0,
  });
}

/** Reference prices are per token; never divide by an assumed 1:1 multiplier. */
export function referenceUsdPerShare(
  referencePrice?: string | null,
  ratio?: string | null,
): bigint | null {
  if (referencePrice == null || ratio == null) return null;
  try {
    const price = parseDecimal(referencePrice, 18);
    const divisor = parseDecimal(ratio, 18);
    if (price <= 0n || divisor <= 0n) return null;
    const result = mulDiv(price, E18, divisor);
    return result > 0n ? result : null;
  } catch {
    // Caller emits a warning for the missing fact; input strings never enter logs.
    return null;
  }
}

export function positionShares(
  balance: bigint | null,
  multiplier: bigint | null,
  decimals: number | null,
): bigint | null {
  return balance !== null && multiplier !== null && decimals === 18
    ? mulDiv(balance, multiplier, E18)
    : null;
}

export interface CollectorSnapshot {
  positionKeys: string[];
}
export interface PositionStatus {
  token: string;
  ticker: string | null;
  issuer: Position["issuer"] | null;
  shares: bigint | null;
  usdValue: bigint | null;
  grade: Position["grade"];
  paused: boolean | null;
  ageMs: number | null;
  stale: boolean;
  warnings: readonly string[];
}
export interface CollectorStatus {
  state: "never collected" | "empty" | "stale" | "ok";
  ageMs: number | null;
}
export function loadPositionStatus(
  store: SnapshotStore,
  wallet: string,
  policy: PolicySettings,
  now: number,
) {
  const collection = store.latest<CollectorSnapshot>("autopilot-collector", wallet.toLowerCase(), {
    maxAgeMs: POSITION_MAX_AGE_MS,
    now,
  });
  const positions: PositionStatus[] = policy.tokenAllowList.map((token) => {
    const snap = store.latest<Position & { warnings?: string[] }>(
      "autopilot-position",
      positionKey(wallet, token),
      {
        maxAgeMs: POSITION_MAX_AGE_MS,
        now,
      },
    );
    const p = snap?.data;
    return {
      token: token.toLowerCase(),
      ticker: p?.ticker ?? null,
      issuer: p?.issuer ?? null,
      shares: p?.shares ?? null,
      usdValue:
        p?.shares != null && p.usdPerShare != null ? mulDiv(p.shares, p.usdPerShare, E18) : null,
      grade: p?.grade ?? null,
      paused: p?.paused ?? null,
      ageMs: snap?.ageMs ?? null,
      stale:
        !snap || snap.stale || p!.observedAt > now || now - p!.observedAt > POSITION_MAX_AGE_MS,
      warnings: p?.warnings ?? (snap ? [] : ["Position not collected"]),
    };
  });
  const collector: CollectorStatus = {
    state: !collection
      ? "never collected"
      : collection.stale || positions.some((p) => p.stale)
        ? "stale"
        : collection.data.positionKeys.length === 0
          ? "empty"
          : "ok",
    ageMs: collection?.ageMs ?? null,
  };
  return { positions, collector };
}
