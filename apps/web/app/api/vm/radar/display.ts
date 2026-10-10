import {
  displayFlow,
  type FlowPanelDisplay,
  type RadarVM,
} from "../../../../modules/flow/view-model";

/** What `/api/vm/radar` sends: the Radar view model with every bigint turned into a decimal string and no engine internals. */
export interface RadarGradeDisplay {
  address: string;
  symbol: string;
  issuer: "ondo" | "bstock" | "xstocks";
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  reasons: string[];
  ghost: boolean;
  ghostReasons: string[];
  unitTrap: boolean;
  /** Raw 24h onchain volume in whole dollars, or null when unknown. This is the figure the Trade page quote grade uses. */
  rawVolume24hUsd: string | null;
  /** False when a recorded fact blocks buying; null when Radar cannot say (never true by guess). */
  executable: boolean | null;
  executableReason: string | null;
  /** The flow module's cleaned 24h volume in whole dollars, or null when flow has none. */
  cleanedFlowUsd24h: string | null;
  flowActive: boolean;
  flowReason: string | null;
  stale: boolean;
  ageMs: number;
  source: string;
  gradeBasis: "engine" | "cleaned flow";
}
export interface RadarCardDisplay {
  ticker: string;
  grades: RadarGradeDisplay[];
  flowPanel: FlowPanelDisplay | null;
}
export interface RadarDisplay {
  state: RadarVM["state"];
  reason: string | null;
  error: string | null;
  flowEnabled: boolean;
  source: string | null;
  stale: boolean;
  ageMs: number | null;
  cards: RadarCardDisplay[];
}

const E18 = 10n ** 18n;

export function displayRadar(vm: RadarVM): RadarDisplay {
  return {
    state: vm.state,
    reason: vm.reason,
    error: vm.error,
    flowEnabled: vm.flowEnabled,
    source: vm.source,
    stale: vm.stale,
    ageMs: vm.ageMs,
    cards: vm.cards.map((c) => ({
      ticker: c.ticker,
      flowPanel: c.flowPanel ? displayFlow(c.flowPanel) : null,
      grades: c.grades.map((g) => ({
        address: g.address,
        symbol: g.symbol,
        issuer: g.issuer,
        grade: g.grade,
        score: g.score,
        reasons: g.reasons,
        ghost: g.ghost,
        ghostReasons: g.ghostReasons ?? [],
        unitTrap: g.integrity?.unitTrap ?? false,
        rawVolume24hUsd:
          g.rawVolume24hUsd === null || g.rawVolume24hUsd === undefined
            ? null
            : (BigInt(g.rawVolume24hUsd) / E18).toString(),
        executable: g.executable ?? null,
        executableReason: g.executableReason ?? null,
        cleanedFlowUsd24h:
          g.cleanedFlowUsd24h === null || g.cleanedFlowUsd24h === undefined
            ? null
            : (BigInt(g.cleanedFlowUsd24h) / E18).toString(),
        flowActive: g.flowActive !== false,
        flowReason: g.flowReason ?? null,
        stale: g.stale,
        ageMs: g.ageMs,
        source: g.source,
        gradeBasis: g.gradeBasis,
      })),
    })),
  };
}
