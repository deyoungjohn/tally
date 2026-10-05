import {
  aggregateFlow,
  ghostInput,
  extendIntegrity,
  FLOW_MAX_AGE_MS,
  RADAR_MAX_AGE_MS,
  type FlowAggregate,
  type FlowSnapshot,
  type FlowToken,
  type FlowWindow,
  type FlowTrade,
} from "@tally/mod-flow";
import type { Integrity } from "@tally/core";
import { openStore, type SnapshotStore } from "@tally/modkit";

export interface FlowPanelVM {
  ticker: string;
  state: "ready" | "empty" | "error";
  issuers: (FlowAggregate & {
    source: string;
    stale: boolean;
    ageMs: number;
    observedAt: number;
    sourceLabel: string;
  })[];
  source: string | null;
  sourceLabel: string | null;
  stale: boolean;
  ageMs: number | null;
  reason: string | null;
  error: string | null;
}
export interface RadarGradeSnapshot {
  ticker: string;
  address: string;
  symbol: string;
  issuer: FlowToken["issuer"];
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  reasons: string[];
  ghost: boolean;
  ghostPoints?: number;
  ghostReasons?: string[];
  totalDeductions?: number;
  integrity: Integrity;
  rawVolume24hUsd?: bigint | null;
  flowActive?: boolean;
  flowReason?: string | null;
}
export interface RadarFilters {
  issuer?: FlowToken["issuer"];
  grade?: RadarGradeSnapshot["grade"];
  ghost?: boolean;
}
export interface RadarCardVM {
  ticker: string;
  grades: (RadarGradeSnapshot & {
    stale: boolean;
    ageMs: number;
    source: string;
    gradeBasis: "engine" | "cleaned flow";
  })[];
  flowPanel: FlowPanelVM | null;
}
export interface RadarVM {
  state: "ready" | "empty" | "error";
  cards: RadarCardVM[];
  filters: RadarFilters;
  flowEnabled: boolean;
  source: string | null;
  stale: boolean;
  ageMs: number | null;
  reason: string | null;
  error: string | null;
}
export type FlowViewModel = FlowPanelVM;
interface LoadOptions {
  store?: SnapshotStore;
  now?: number;
  tokens?: readonly FlowToken[];
}
const empty = (ticker: string, error: string | null = null): FlowPanelVM => ({
  ticker,
  state: error ? "error" : "empty",
  issuers: [],
  stale: false,
  ageMs: null,
  source: null,
  sourceLabel: null,
  reason: error ? "Flow could not load its snapshots." : "Flow has no observations yet.",
  error,
});

/** All data comes from the shared snapshot store. No engine/network calls on the UI path. */
export async function loadFlow(ticker = "NVDA", options: LoadOptions = {}): Promise<FlowPanelVM> {
  let owned: ReturnType<typeof openStore> | null = null;
  const now = options.now ?? Date.now();
  try {
    owned = options.store ? null : openStore();
    const store = options.store ?? owned!;
    const tokens =
      options.tokens ??
      store.latest<FlowToken[]>("flow-registry", "bsc", { maxAgeMs: FLOW_MAX_AGE_MS, now })?.data ??
      [];
    const issuers: FlowPanelVM["issuers"] = [];
    const missing: string[] = [];
    for (const token of tokens.filter((t) => t.ticker.toUpperCase() === ticker.toUpperCase())) {
      const snapshot = store.latest<FlowSnapshot>("flow", token.address.toLowerCase(), {
        maxAgeMs: FLOW_MAX_AGE_MS,
        now,
      });
      if (!snapshot) {
        missing.push(`${token.symbol}: no flow observation`);
        continue;
      }
      issuers.push({
        ...aggregateFlow(snapshot.data, now),
        source: snapshot.source,
        sourceLabel: snapshot.source === "chain-logs" ? "from chain logs" : "from Binance",
        stale: snapshot.stale,
        ageMs: snapshot.ageMs,
        observedAt: snapshot.observedAt,
      });
    }
    if (!issuers.length)
      return {
        ...empty(ticker),
        reason: missing.length ? missing.join("; ") : empty(ticker).reason,
      };
    const sources = [...new Set(issuers.map((i) => i.source))];
    return {
      ticker,
      state: "ready",
      issuers,
      stale: issuers.some((i) => i.stale),
      ageMs: Math.max(...issuers.map((i) => i.ageMs)),
      source: sources.length === 1 ? sources[0]! : "mixed",
      sourceLabel: sources.includes("chain-logs") ? "from chain logs" : "from Binance",
      reason: missing.length ? missing.join("; ") : null,
      error: null,
    };
  } catch {
    return empty(ticker, "Snapshot store unavailable");
  } finally {
    owned?.close();
  }
}
export async function loadRadar(
  options: LoadOptions & { flowEnabled?: boolean; filters?: RadarFilters } = {},
): Promise<RadarVM> {
  let owned: ReturnType<typeof openStore> | null = null;
  const now = options.now ?? Date.now();
  const flowEnabled = options.flowEnabled ?? process.env.FEATURE_FLOW === "1",
    filters = options.filters ?? {};
  const result: RadarVM = {
    state: "empty",
    cards: [],
    filters,
    flowEnabled,
    source: null,
    stale: false,
    ageMs: null,
    reason: "Radar has no grade observations yet.",
    error: null,
  };
  try {
    owned = options.store ? null : openStore();
    const store = options.store ?? owned!;
    const tokens =
      options.tokens ??
      store.latest<FlowToken[]>("radar-registry", "bsc", { maxAgeMs: RADAR_MAX_AGE_MS, now })
        ?.data ??
      store.latest<FlowToken[]>("flow-registry", "bsc", { maxAgeMs: FLOW_MAX_AGE_MS, now })?.data ??
      [];
    const cards = new Map<string, RadarCardVM>();
    for (const token of tokens) {
      const snapshot = store.latest<RadarGradeSnapshot>("radar", token.address.toLowerCase(), {
        maxAgeMs: RADAR_MAX_AGE_MS,
        now,
      });
      if (!snapshot) continue;
      let grade = snapshot.data;
      let gradeBasis: "engine" | "cleaned flow" = "engine";
      if (flowEnabled && grade.flowActive !== false) {
        const flow = store.latest<FlowSnapshot>("flow", token.address.toLowerCase(), {
          maxAgeMs: FLOW_MAX_AGE_MS,
          now,
        });
        if (flow && grade.integrity) {
          const integrity = extendIntegrity(
            grade.integrity,
            ghostInput(aggregateFlow(flow.data, now), flow.stale),
          );
          grade = {
            ...grade,
            integrity,
            score: integrity.score,
            grade: integrity.grade,
            reasons: integrity.reasons.map((r) => r.reason ?? r.summary),
            ghost: integrity.flags.includes("ghost"),
            totalDeductions: integrity.checks.reduce((sum, c) => sum + c.points, 0),
            ghostPoints: integrity.checks
              .filter((c) => c.flag === "ghost")
              .reduce((sum, c) => sum + c.points, 0),
            ghostReasons: integrity.reasons
              .filter((c) => c.flag === "ghost")
              .map((c) => c.reason ?? c.summary),
          };
          if (integrity.flowCheck.outcome !== "skipped") gradeBasis = "cleaned flow";
        }
      }
      if (
        (filters.issuer && grade.issuer !== filters.issuer) ||
        (filters.grade && grade.grade !== filters.grade) ||
        (filters.ghost !== undefined && grade.ghost !== filters.ghost)
      )
        continue;
      const card = cards.get(token.ticker) ?? { ticker: token.ticker, grades: [], flowPanel: null };
      card.grades.push({
        ...grade,
        gradeBasis,
        stale: snapshot.stale,
        ageMs: snapshot.ageMs,
        source: snapshot.source,
      });
      cards.set(token.ticker, card);
    }
    for (const card of cards.values())
      if (flowEnabled && card.grades.some((g) => g.flowActive !== false))
        card.flowPanel = await loadFlow(card.ticker, {
          store,
          now,
          tokens: tokens.filter((t) =>
            card.grades.some((g) => g.address === t.address && g.flowActive !== false),
          ),
        });
    result.cards = [...cards.values()];
    if (result.cards.length) {
      result.state = "ready";
      result.reason = null;
      const grades = result.cards.flatMap((c) => c.grades);
      result.stale = grades.some((g) => g.stale);
      result.ageMs = Math.max(...grades.map((g) => g.ageMs));
      result.source = [...new Set(grades.map((g) => g.source))].join(", ");
    }
    return result;
  } catch {
    return {
      ...result,
      state: "error",
      reason: "Radar could not load its snapshots.",
      error: "Snapshot store unavailable",
    };
  } finally {
    owned?.close();
  }
}

/** UI-safe serialization: all share/USD quantities leave the server as decimal strings. */
export interface FlowPanelDisplay {
  ticker: string;
  state: FlowPanelVM["state"];
  reason: string | null;
  issuers: {
    issuer: string;
    sourceLabel: string;
    stale: boolean;
    ageMs: number;
    windows: {
      window: FlowWindow;
      netShares: string;
      buys: number;
      sells: number;
      reason: string | null;
    }[];
    lastRealTradeAgeMs: number | null;
    lastRealTradeReason: string | null;
    concentration: string | null;
    concentrationReason: string | null;
    whalePrints: {
      txHash: string;
      side: FlowTrade["side"];
      shares: string;
      usd: string;
      at: number;
    }[];
    notes: string[];
  }[];
}
// @tally/core is already mod-flow's unit authority; format using bigint string operations here for the UI contract.
function units(n: bigint): string {
  const negative = n < 0n,
    magnitude = negative ? -n : n;
  return `${negative ? "-" : ""}${magnitude / 10n ** 18n}.${(magnitude % 10n ** 18n).toString().padStart(18, "0").slice(0, 6)}`;
}
export function displayFlow(vm: FlowPanelVM): FlowPanelDisplay {
  return {
    ticker: vm.ticker,
    state: vm.state,
    reason: vm.reason,
    issuers: vm.issuers.map((i) => ({
      issuer: i.issuer,
      sourceLabel: i.sourceLabel,
      stale: i.stale,
      ageMs: i.ageMs,
      windows: (Object.keys(i.windows) as FlowWindow[]).map((window) => ({
        window,
        netShares: units(i.windows[window].netShares),
        buys: i.windows[window].buys,
        sells: i.windows[window].sells,
        reason: i.windows[window].reason,
      })),
      lastRealTradeAgeMs: i.lastRealTradeAgeMs,
      lastRealTradeReason: i.lastRealTradeReason,
      concentration:
        i.top10ConcentrationPercent === null ? null : units(i.top10ConcentrationPercent),
      concentrationReason: i.concentrationReason,
      whalePrints: i.whalePrints.map((p) => ({
        txHash: p.txHash,
        side: p.side,
        shares: units(p.shares),
        usd: units(p.usd!),
        at: p.at,
      })),
      notes: i.notes,
    })),
  };
}
