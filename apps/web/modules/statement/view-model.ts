import {
  formatUnits,
  formatUsd,
  exportStatementCsv,
  buildPortfolioSuggestions,
  type Issuer,
  type Statement,
  type HoldingRowActionMeta,
  type PortfolioSuggestions,
  type PortfolioSuggestionItem,
  type PortfolioSuggestionsState,
  type CandidateTokenInput,
} from "@tally/mod-statement";
import { flags as getFlags, type ModuleName } from "@tally/config";
import type { SnapshotStore } from "@tally/modkit";
import { GENERATED_BUYABLE_ASSETS } from "../../lib/buyable.generated";
import { isTokenBuyable, nameOf } from "../../lib/tickers";
import { RADAR_MAX_AGE_MS, FLOW_MAX_AGE_MS, type FlowAggregate } from "@tally/mod-flow";
import type { RadarGradeSnapshot } from "../flow/view-model";

export type PortfolioTab = "holdings" | "activity" | "statement";

export type {
  HoldingRowActionMeta,
  PortfolioSuggestions,
  PortfolioSuggestionItem,
  PortfolioSuggestionsState,
};
export type PortfolioSuggestionsVM = PortfolioSuggestions;
export type PortfolioSuggestionItemVM = PortfolioSuggestionItem;

export interface IssuerHoldingVM {
  issuer: Issuer | null;
  tokenSymbol: string;
  tokenContractAddress: string;
  balanceTokens: string;
  multiplier: string;
  balanceShares: string;
  convertedAtTodaysRatio: boolean;
  valueUsd: string;
  pricePerShareUsd: string;
  /** Why `balanceShares` reads "unavailable" (additive; absent when shares are known). */
  sharesUnavailableReason?: string;
  rowActionsSlot: HoldingRowActionMeta;
}

export interface HeadlineHoldingVM {
  ticker: string;
  totalShares: string;
  totalValueUsd: string;
  avgCostPerShareUsd: string;
  unrealizedPnlUsd: string;
  unrealizedPnlPercent: string;
  issuers: IssuerHoldingVM[];
  rowActionsSlot: HoldingRowActionMeta;
}

export interface PortfolioVM {
  state: "ready" | "empty" | "error";
  walletAddress: string | null;
  totalValueUsd: string;
  totalRealizedPnlUsd: string;
  totalUnrealizedPnlUsd: string;
  holdings: HeadlineHoldingVM[];
  /**
   * Additive. For `state: "empty"`: `never_collected` means no snapshot of this wallet exists yet (the worker has not collected
   * it), `no_holdings` means a snapshot exists and holds nothing. Absent when the state is not empty.
   */
  emptyKind?: "never_collected" | "no_holdings";
  /** Additive. True only when at least one sale carries a realized figure; otherwise `totalRealizedPnlUsd` is a placeholder zero. */
  realizedKnown?: boolean;
  availableTabs: PortfolioTab[];
  activeTab: PortfolioTab;
  /** Additive (WO-03 / wo03-portfolio-suggestions.md). Suggestions for wallets holding fewer than 3 stocks. */
  suggestions: PortfolioSuggestionsVM;
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  reason?: string | null;
  error: string | null;
}

export interface StatementLineVM {
  date: string;
  ticker: string;
  issuer: Issuer | null;
  type: "BUY" | "SELL";
  amountTokens: string;
  multiplier: string;
  amountShares: string;
  pricePerShareUsd: string;
  valueUsd: string;
  realizedPnlUsd?: string;
  convertedAtTodaysRatio: boolean;
  /** Why `amountShares` reads "unavailable" (additive; absent when shares are known). */
  sharesUnavailableReason?: string;
  txHash?: string;
}

export interface StatementVM {
  state: "ready" | "empty" | "error" | "degraded";
  walletAddress: string | null;
  asOf: string | null;
  asOfReason?: string;
  lines: StatementLineVM[];
  /** Additive: see `PortfolioVM.emptyKind`. */
  emptyKind?: "never_collected" | "no_holdings";
  /** Additive: see `PortfolioVM.realizedKnown`. */
  realizedKnown?: boolean;
  totalValueUsd: string;
  totalCostBasisUsd: string;
  totalRealizedPnlUsd: string;
  totalUnrealizedPnlUsd: string;
  differsFromApi: boolean;
  differsFromApiNote?: string;
  convertedAtTodaysRatio: boolean;
  convertedAtTodaysRatioNote?: string;
  notes: string[];
  csv: {
    filename: string;
    content: string;
  };
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  reason?: string | null;
  error: string | null;
}

/** Build PortfolioVM from calculated Statement domain object */
export function buildPortfolioVM(
  stmt: Statement | null,
  opts?: {
    walletAddress?: string;
    flags?: Partial<Record<ModuleName, boolean>>;
    stale?: boolean;
    ageMs?: number | null;
    source?: string | null;
    error?: string | null;
    suggestions?: PortfolioSuggestionsVM;
  },
): PortfolioVM {
  const activeFlags = { ...getFlags(), ...(opts?.flags ?? {}) };
  const availableTabs: PortfolioTab[] = ["holdings"];
  if (activeFlags.receipts) availableTabs.push("activity");
  if (activeFlags.statement) availableTabs.push("statement");

  const walletAddress = stmt?.walletAddress ?? opts?.walletAddress ?? null;
  const stale = opts?.stale ?? false;
  const ageMs = opts?.ageMs ?? null;
  const source = opts?.source ?? stmt?.source ?? null;

  const isFixture = opts?.source?.includes("fixture") || process.env.TALLY_FIXTURES === "1";
  const suggestions =
    opts?.suggestions ??
    (walletAddress && (!stmt || stale)
      ? {
          count: 0,
          items: [],
          state: "unavailable" as const,
          reasonText: "Your holdings are still loading",
          ...(isFixture ? { fixture: true } : {}),
        }
      : buildPortfolioSuggestions({
          walletAddress,
          held: stmt?.holdings ?? [],
          candidates: [],
          radarMissing: true,
          isFixture,
        }));

  if (opts?.error) {
    return {
      state: "error",
      walletAddress,
      totalValueUsd: "0.00",
      totalRealizedPnlUsd: "0.00",
      totalUnrealizedPnlUsd: "0.00",
      holdings: [],
      realizedKnown: false,
      availableTabs,
      activeTab: "holdings",
      suggestions,
      stale,
      ageMs,
      source,
      error: opts.error,
    };
  }

  if (!stmt || stmt.holdings.length === 0) {
    return {
      state: "empty",
      walletAddress,
      totalValueUsd: "0.00",
      totalRealizedPnlUsd: "0.00",
      totalUnrealizedPnlUsd: "0.00",
      holdings: [],
      emptyKind: stmt ? "no_holdings" : "never_collected",
      realizedKnown: false,
      availableTabs,
      activeTab: "holdings",
      suggestions,
      stale,
      ageMs,
      source,
      reason: "No holdings in this wallet.",
      error: null,
    };
  }

  const holdings: HeadlineHoldingVM[] = Object.values(stmt.holdingsByTicker).map((group) => {
    const issuers: IssuerHoldingVM[] = group.issuers.map((h) => {
      const balanceSharesStr =
        h.balanceShares !== null ? formatUnits(h.balanceShares, 18, 4) : "unavailable";
      return {
        issuer: h.issuer,
        tokenSymbol: h.tokenSymbol,
        tokenContractAddress: h.tokenContractAddress,
        balanceTokens: formatUnits(h.balanceTokens, 18, 4),
        multiplier: h.multiplier !== null ? formatUnits(h.multiplier, 18, 4) : "unavailable",
        balanceShares: balanceSharesStr,
        convertedAtTodaysRatio: h.convertedAtTodaysRatio,
        valueUsd: formatUsd(h.tokenBalanceUsdE18),
        pricePerShareUsd: h.pricePerShareUsdE18 ? formatUsd(h.pricePerShareUsdE18) : "-",
        ...(h.sharesUnavailableReason
          ? { sharesUnavailableReason: h.sharesUnavailableReason }
          : {}),
        rowActionsSlot: {
          token: h.tokenContractAddress,
          issuer: h.issuer,
          balanceTokens: formatUnits(h.balanceTokens, 18, 4),
          balanceShares: h.balanceShares !== null ? balanceSharesStr : null,
          ticker: h.ticker,
        },
      };
    });

    const primary = group.issuers[0];
    const totalSharesStr = formatUnits(group.totalShares, 18, 4);
    const rowActionsSlot: HoldingRowActionMeta = {
      token: primary?.tokenContractAddress ?? "",
      issuer: primary?.issuer ?? null,
      balanceTokens: formatUnits(primary?.balanceTokens ?? 0n, 18, 4),
      balanceShares: totalSharesStr,
      ticker: group.ticker,
    };

    let pnlPct = "0.00";
    if (group.totalCostBasisUsdE18 > 0n) {
      const basisNum = Number(formatUnits(group.totalCostBasisUsdE18, 18));
      const pnlNum = Number(formatUnits(group.unrealizedPnlUsdE18, 18));
      pnlPct = ((pnlNum / basisNum) * 100).toFixed(2);
    }

    return {
      ticker: group.ticker,
      totalShares: totalSharesStr,
      totalValueUsd: formatUsd(group.totalValueUsdE18),
      avgCostPerShareUsd:
        group.avgCostPerShareUsdE18 !== null ? formatUsd(group.avgCostPerShareUsdE18) : "-",
      unrealizedPnlUsd: formatUsd(group.unrealizedPnlUsdE18),
      unrealizedPnlPercent: pnlPct,
      issuers,
      rowActionsSlot,
    };
  });

  return {
    state: "ready",
    walletAddress,
    totalValueUsd: formatUsd(stmt.totalValueUsdE18),
    totalRealizedPnlUsd: formatUsd(stmt.totalRealizedPnlUsdE18),
    totalUnrealizedPnlUsd: formatUsd(stmt.totalUnrealizedPnlUsdE18),
    holdings,
    realizedKnown: stmt.trades.some((t) => t.realizedPnlUsdE18 !== undefined),
    availableTabs,
    activeTab: "holdings",
    suggestions,
    stale,
    ageMs,
    source,
    error: null,
  };
}

/** Build StatementVM from Statement domain object */
export function buildStatementVM(
  stmt: Statement | null,
  opts?: {
    walletAddress?: string;
    stale?: boolean;
    ageMs?: number | null;
    source?: string | null;
    error?: string | null;
    asOf?: number | null;
  },
): StatementVM {
  const walletAddress = stmt?.walletAddress ?? opts?.walletAddress ?? null;
  const stale = opts?.stale ?? false;
  const ageMs = opts?.ageMs ?? null;
  const source = opts?.source ?? stmt?.source ?? null;

  if (opts?.error) {
    return {
      state: "error",
      walletAddress,
      asOf: null,
      asOfReason: "Error loading statement",
      lines: [],
      realizedKnown: false,
      totalValueUsd: "0.00",
      totalCostBasisUsd: "0.00",
      totalRealizedPnlUsd: "0.00",
      totalUnrealizedPnlUsd: "0.00",
      differsFromApi: false,
      convertedAtTodaysRatio: false,
      notes: [],
      csv: {
        filename: "statement-error.csv",
        content: "",
      },
      stale,
      ageMs,
      source,
      error: opts.error,
    };
  }

  if (!stmt || (stmt.holdings.length === 0 && stmt.trades.length === 0)) {
    const asOfMs = opts?.asOf ?? null;
    return {
      state: "empty",
      walletAddress,
      asOf: asOfMs ? new Date(asOfMs).toISOString() : null,
      asOfReason: asOfMs ? undefined : "Statement has no observations yet.",
      lines: [],
      emptyKind: stmt ? "no_holdings" : "never_collected",
      realizedKnown: false,
      totalValueUsd: "0.00",
      totalCostBasisUsd: "0.00",
      totalRealizedPnlUsd: "0.00",
      totalUnrealizedPnlUsd: "0.00",
      differsFromApi: false,
      convertedAtTodaysRatio: false,
      notes: [],
      csv: {
        filename: "statement-empty.csv",
        content: "",
      },
      stale,
      ageMs,
      source,
      reason: "Statement has no observations yet.",
      error: null,
    };
  }

  // Lines are for tokenized stocks. A swap also moves BNB or USDT, and those legs are not buys or sales of a stock.
  const lines: StatementLineVM[] = stmt.trades
    .filter((t) => t.isRecognized)
    .map((t) => ({
      date: new Date(t.time).toISOString(),
      ticker: t.ticker,
      issuer: t.issuer,
      type: t.type,
      amountTokens: formatUnits(t.amountTokens, 18, 4),
      multiplier: t.multiplier !== null ? formatUnits(t.multiplier, 18, 4) : "unavailable",
      amountShares: t.amountShares !== null ? formatUnits(t.amountShares, 18, 4) : "unavailable",
      pricePerShareUsd: t.pricePerShareUsdE18 ? formatUsd(t.pricePerShareUsdE18) : "-",
      valueUsd: formatUsd(t.valueUsdE18),
      realizedPnlUsd:
        t.realizedPnlUsdE18 !== undefined ? formatUsd(t.realizedPnlUsdE18) : undefined,
      convertedAtTodaysRatio: t.convertedAtTodaysRatio,
      ...(t.sharesUnavailableReason ? { sharesUnavailableReason: t.sharesUnavailableReason } : {}),
      txHash: t.txHash,
    }));

  const convertedAtTodaysRatio = stmt.convertedAtTodaysRatioCount > 0;
  const convertedAtTodaysRatioNote = convertedAtTodaysRatio
    ? `${stmt.convertedAtTodaysRatioCount} transaction(s) converted at today's ratio`
    : undefined;

  const addrPrefix = (walletAddress ?? "wallet").slice(0, 8);
  const dateStr = stmt.asOf ? new Date(stmt.asOf).toISOString().slice(0, 10) : "undated";
  const csvFilename = `tally-statement-${addrPrefix}-${dateStr}.csv`;

  return {
    state: stmt.source === "receipts" ? "degraded" : "ready",
    walletAddress,
    asOf: stmt.asOf ? new Date(stmt.asOf).toISOString() : null,
    asOfReason: stmt.asOfReason,
    lines,
    realizedKnown: stmt.trades.some((t) => t.realizedPnlUsdE18 !== undefined),
    totalValueUsd: formatUsd(stmt.totalValueUsdE18),
    totalCostBasisUsd: formatUsd(stmt.totalCostBasisUsdE18),
    totalRealizedPnlUsd: formatUsd(stmt.totalRealizedPnlUsdE18),
    totalUnrealizedPnlUsd: formatUsd(stmt.totalUnrealizedPnlUsdE18),
    differsFromApi: stmt.differsFromApi,
    differsFromApiNote: stmt.differsFromApiNote,
    convertedAtTodaysRatio,
    convertedAtTodaysRatioNote,
    notes: stmt.notes,
    csv: {
      filename: csvFilename,
      content: exportStatementCsv({ ...stmt, trades: stmt.trades.filter((t) => t.isRecognized) }),
    },
    stale,
    ageMs,
    source,
    error: null,
  };
}

/**
 * Reads Radar grade snapshots and flow-aggregate snapshots from the store
 * to build candidate tokens for portfolio suggestions (no network calls, no full tape).
 */
export function loadSuggestionsFromStore(
  store: SnapshotStore,
  held: Parameters<typeof buildPortfolioSuggestions>[0]["held"],
  walletAddress?: string | null,
  now = Date.now(),
): PortfolioSuggestionsVM {
  const isFixture = process.env.TALLY_FIXTURES === "1";

  // If a wallet address is provided (signed-in user), verify that the statement snapshot
  // exists in the store and is fresh. If missing or stale, holdings are unknown.
  if (walletAddress && walletAddress.trim()) {
    const stmtSnap = store.latest<Statement>("statement", walletAddress.toLowerCase(), {
      maxAgeMs: 300_000,
      now,
    });
    if (!stmtSnap || stmtSnap.stale) {
      return {
        count: 0,
        items: [],
        state: "unavailable",
        reasonText: "Your holdings are still loading",
        ...(isFixture ? { fixture: true } : {}),
      };
    }
    if (!held || (Array.isArray(held) && held.length === 0 && stmtSnap.data.holdings.length > 0)) {
      held = stmtSnap.data.holdings;
    }
  }

  let anyRadarRowFound = false;
  const candidates: CandidateTokenInput[] = [];

  for (const asset of GENERATED_BUYABLE_ASSETS) {
    if (!isTokenBuyable(asset.ticker, asset.kind)) continue;

    const radarSnap = store.latest<RadarGradeSnapshot>("radar", asset.address.toLowerCase(), {
      maxAgeMs: RADAR_MAX_AGE_MS,
      now,
    });

    if (!radarSnap) continue;
    anyRadarRowFound = true;

    const flowSnap = store.latest<FlowAggregate>("flow-aggregate", asset.address.toLowerCase(), {
      maxAgeMs: FLOW_MAX_AGE_MS,
      now,
    });

    const realVolumeUsd = flowSnap?.data?.windows?.["24h"]?.realVolumeUsd;
    const rawVolume24hUsd = radarSnap.data.rawVolume24hUsd;
    const cleanedVolumeUsd = realVolumeUsd ?? rawVolume24hUsd ?? 0n;

    candidates.push({
      ticker: asset.ticker,
      symbol: asset.symbol,
      issuer: asset.kind,
      name: nameOf(asset.ticker),
      address: asset.address,
      grade: radarSnap.data.grade,
      score: radarSnap.data.score,
      ghost: radarSnap.data.ghost,
      stale: radarSnap.stale,
      cleanedVolumeUsd,
      reason: radarSnap.data.reasons?.[0] ?? "Liquid on-chain",
    });
  }

  return buildPortfolioSuggestions({
    walletAddress,
    held,
    candidates,
    radarMissing: !anyRadarRowFound,
    isFixture,
  });
}

/** Server/component loader for portfolio view model */
export async function loadPortfolio(opts?: {
  walletAddress?: string;
  store?: SnapshotStore;
  flags?: Partial<Record<ModuleName, boolean>>;
  now?: number;
}): Promise<PortfolioVM> {
  const wallet = opts?.walletAddress;
  const store = opts?.store;
  const now = opts?.now ?? Date.now();

  let stmt: Statement | null = null;
  let snapInfo: { stale?: boolean; ageMs?: number | null; source?: string | null } = {};

  if (wallet && store) {
    const snap = store.latest<Statement>("statement", wallet.toLowerCase(), {
      maxAgeMs: 300_000,
      now,
    });
    if (snap) {
      stmt = snap.data;
      snapInfo = { stale: snap.stale, ageMs: snap.ageMs, source: snap.source };
    }
  }

  let suggestions: PortfolioSuggestionsVM | undefined;
  if (store) {
    if (wallet && (!stmt || snapInfo.stale)) {
      const isFixture =
        process.env.TALLY_FIXTURES === "1" || (snapInfo.source?.includes("fixture") ?? false);
      suggestions = {
        count: 0,
        items: [],
        state: "unavailable",
        reasonText: "Your holdings are still loading",
        ...(isFixture ? { fixture: true } : {}),
      };
    } else {
      const heldInput = stmt?.holdings ?? [];
      suggestions = loadSuggestionsFromStore(store, heldInput, wallet, now);
    }
  }

  return buildPortfolioVM(stmt, {
    walletAddress: wallet,
    flags: opts?.flags,
    stale: snapInfo.stale,
    ageMs: snapInfo.ageMs,
    source: snapInfo.source,
    suggestions,
  });
}

/** Server/component loader for statement view model */
export async function loadStatement(opts?: {
  walletAddress?: string;
  store?: SnapshotStore;
}): Promise<StatementVM> {
  const wallet = opts?.walletAddress;
  if (!wallet) {
    return buildStatementVM(null);
  }

  if (opts?.store) {
    const snap = opts.store.latest<Statement>("statement", wallet.toLowerCase(), {
      maxAgeMs: 300_000,
    });
    if (snap) {
      return buildStatementVM(snap.data, {
        walletAddress: wallet,
        stale: snap.stale,
        ageMs: snap.ageMs,
        source: snap.source,
        asOf: snap.observedAt,
      });
    }
  }

  return buildStatementVM(null, { walletAddress: wallet });
}
