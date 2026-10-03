import { formatUnits, exportStatementCsv, type Issuer, type Statement } from "@tally/mod-statement";
import { flags as getFlags, type ModuleName } from "@tally/config";
import type { SnapshotStore } from "@tally/modkit";

export type PortfolioTab = "holdings" | "activity" | "statement";

export interface HoldingRowActionMeta {
  token: string;
  issuer: Issuer;
  balanceTokens: string;
  balanceShares: string;
}

export interface IssuerHoldingVM {
  issuer: Issuer;
  tokenSymbol: string;
  tokenContractAddress: string;
  balanceTokens: string;
  multiplier: string;
  balanceShares: string;
  convertedAtTodaysRatio: boolean;
  valueUsd: string;
  pricePerShareUsd: string;
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
  availableTabs: PortfolioTab[];
  activeTab: PortfolioTab;
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  reason?: string | null;
  error: string | null;
}

export interface StatementLineVM {
  date: string;
  ticker: string;
  issuer: Issuer;
  type: "BUY" | "SELL";
  amountTokens: string;
  multiplier: string;
  amountShares: string;
  pricePerShareUsd: string;
  valueUsd: string;
  realizedPnlUsd?: string;
  convertedAtTodaysRatio: boolean;
  txHash?: string;
}

export interface StatementVM {
  state: "ready" | "empty" | "error" | "degraded";
  walletAddress: string | null;
  asOf: string;
  lines: StatementLineVM[];
  totalValueUsd: string;
  totalCostBasisUsd: string;
  totalRealizedPnlUsd: string;
  totalUnrealizedPnlUsd: string;
  differsFromApi: boolean;
  differsFromApiNote?: string;
  convertedAtTodaysRatio: boolean;
  convertedAtTodaysRatioNote?: string;
  notes: string[];
  exportActions: {
    exportCsv: () => string;
    csvFilename: string;
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

  if (opts?.error) {
    return {
      state: "error",
      walletAddress,
      totalValueUsd: "0.00",
      totalRealizedPnlUsd: "0.00",
      totalUnrealizedPnlUsd: "0.00",
      holdings: [],
      availableTabs,
      activeTab: "holdings",
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
      availableTabs,
      activeTab: "holdings",
      stale,
      ageMs,
      source,
      reason: "No holdings in this wallet.",
      error: null,
    };
  }

  const holdings: HeadlineHoldingVM[] = Object.values(stmt.holdingsByTicker).map((group) => {
    const issuers: IssuerHoldingVM[] = group.issuers.map((h) => ({
      issuer: h.issuer,
      tokenSymbol: h.tokenSymbol,
      tokenContractAddress: h.tokenContractAddress,
      balanceTokens: formatUnits(h.balanceTokens, 18, 4),
      multiplier: formatUnits(h.multiplier, 18, 4),
      balanceShares: formatUnits(h.balanceShares, 18, 4),
      convertedAtTodaysRatio: h.convertedAtTodaysRatio,
      valueUsd: h.tokenBalanceUsd.toFixed(2),
      pricePerShareUsd: h.pricePerShareUsd.toFixed(2),
      rowActionsSlot: {
        token: h.tokenContractAddress,
        issuer: h.issuer,
        balanceTokens: formatUnits(h.balanceTokens, 18, 4),
        balanceShares: formatUnits(h.balanceShares, 18, 4),
      },
    }));

    const primary = group.issuers[0];
    const rowActionsSlot: HoldingRowActionMeta = {
      token: primary?.tokenContractAddress ?? "",
      issuer: primary?.issuer ?? "ondo",
      balanceTokens: formatUnits(primary?.balanceTokens ?? 0n, 18, 4),
      balanceShares: formatUnits(group.totalShares, 18, 4),
    };

    return {
      ticker: group.ticker,
      totalShares: formatUnits(group.totalShares, 18, 4),
      totalValueUsd: group.totalValueUsd.toFixed(2),
      avgCostPerShareUsd: group.avgCostPerShareUsd.toFixed(2),
      unrealizedPnlUsd: group.unrealizedPnlUsd.toFixed(2),
      unrealizedPnlPercent: group.unrealizedPnlPercent.toFixed(2),
      issuers,
      rowActionsSlot,
    };
  });

  return {
    state: "ready",
    walletAddress,
    totalValueUsd: stmt.totalValueUsd.toFixed(2),
    totalRealizedPnlUsd: stmt.totalRealizedPnlUsd.toFixed(2),
    totalUnrealizedPnlUsd: stmt.totalUnrealizedPnlUsd.toFixed(2),
    holdings,
    availableTabs,
    activeTab: "holdings",
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
      asOf: new Date().toISOString(),
      lines: [],
      totalValueUsd: "0.00",
      totalCostBasisUsd: "0.00",
      totalRealizedPnlUsd: "0.00",
      totalUnrealizedPnlUsd: "0.00",
      differsFromApi: false,
      convertedAtTodaysRatio: false,
      notes: [],
      exportActions: {
        exportCsv: () => "",
        csvFilename: "statement-error.csv",
      },
      stale,
      ageMs,
      source,
      error: opts.error,
    };
  }

  if (!stmt || (stmt.holdings.length === 0 && stmt.trades.length === 0)) {
    return {
      state: "empty",
      walletAddress,
      asOf: new Date().toISOString(),
      lines: [],
      totalValueUsd: "0.00",
      totalCostBasisUsd: "0.00",
      totalRealizedPnlUsd: "0.00",
      totalUnrealizedPnlUsd: "0.00",
      differsFromApi: false,
      convertedAtTodaysRatio: false,
      notes: [],
      exportActions: {
        exportCsv: () => "",
        csvFilename: "statement-empty.csv",
      },
      stale,
      ageMs,
      source,
      reason: "Statement has no observations yet.",
      error: null,
    };
  }

  const lines: StatementLineVM[] = stmt.trades.map((t) => ({
    date: new Date(t.time).toISOString(),
    ticker: t.ticker,
    issuer: t.issuer,
    type: t.type,
    amountTokens: formatUnits(t.amountTokens, 18, 4),
    multiplier: formatUnits(t.multiplier, 18, 4),
    amountShares: formatUnits(t.amountShares, 18, 4),
    pricePerShareUsd: t.pricePerShareUsd.toFixed(2),
    valueUsd: t.valueUsd.toFixed(2),
    realizedPnlUsd: t.realizedPnlUsd !== undefined ? t.realizedPnlUsd.toFixed(2) : undefined,
    convertedAtTodaysRatio: t.convertedAtTodaysRatio,
    txHash: t.txHash,
  }));

  const convertedAtTodaysRatio = stmt.convertedAtTodaysRatioCount > 0;
  const convertedAtTodaysRatioNote = convertedAtTodaysRatio
    ? `${stmt.convertedAtTodaysRatioCount} transaction(s) converted at today's ratio`
    : undefined;

  const addrPrefix = (walletAddress ?? "wallet").slice(0, 8);
  const dateStr = new Date(stmt.asOf).toISOString().slice(0, 10);
  const csvFilename = `tally-statement-${addrPrefix}-${dateStr}.csv`;

  return {
    state: stmt.source === "receipts" ? "degraded" : "ready",
    walletAddress,
    asOf: new Date(stmt.asOf).toISOString(),
    lines,
    totalValueUsd: stmt.totalValueUsd.toFixed(2),
    totalCostBasisUsd: stmt.totalCostBasisUsd.toFixed(2),
    totalRealizedPnlUsd: stmt.totalRealizedPnlUsd.toFixed(2),
    totalUnrealizedPnlUsd: stmt.totalUnrealizedPnlUsd.toFixed(2),
    differsFromApi: stmt.differsFromApi,
    differsFromApiNote: stmt.differsFromApiNote,
    convertedAtTodaysRatio,
    convertedAtTodaysRatioNote,
    notes: stmt.notes,
    exportActions: {
      exportCsv: () => exportStatementCsv(stmt),
      csvFilename,
    },
    stale,
    ageMs,
    source,
    error: null,
  };
}

/** Server/component loader for portfolio view model */
export async function loadPortfolio(opts?: {
  walletAddress?: string;
  store?: SnapshotStore;
  flags?: Partial<Record<ModuleName, boolean>>;
}): Promise<PortfolioVM> {
  const wallet = opts?.walletAddress;
  if (!wallet) {
    return buildPortfolioVM(null, { flags: opts?.flags });
  }

  if (opts?.store) {
    const snap = opts.store.latest<Statement>("statement", wallet.toLowerCase(), {
      maxAgeMs: 300_000,
    });
    if (snap) {
      return buildPortfolioVM(snap.data, {
        walletAddress: wallet,
        flags: opts.flags,
        stale: snap.stale,
        ageMs: snap.ageMs,
        source: snap.source,
      });
    }
  }

  return buildPortfolioVM(null, { walletAddress: wallet, flags: opts?.flags });
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
      });
    }
  }

  return buildStatementVM(null, { walletAddress: wallet });
}
