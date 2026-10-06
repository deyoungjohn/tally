import {
  PIE_TEMPLATES,
  pieRunState,
  rebalancePlan,
  referencePerShare,
  templateAvailability,
  valuePie,
  type BuyIssuer,
  type PieHolding,
  type PiePrices,
  type PieRun,
  type PieTemplate,
  type RebalanceInput,
  type RebalancePlan,
} from "@tally/mod-pies";
import type { RwaPrice, RwaToken } from "@tally/binance";
import { errorMessage, type Latest, type SnapshotStore } from "@tally/modkit";
import { BUYABLE_TICKERS } from "../../lib/tickers";

export interface SnapshotMeta {
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  error: string | null;
}
interface VMState extends SnapshotMeta {
  state: "ready" | "empty" | "error";
  empty: boolean;
  reason: string | null;
}
type Serializable<T> = T extends bigint
  ? string
  : T extends readonly (infer U)[]
    ? Serializable<U>[]
    : T extends object
      ? { [K in keyof T]: Serializable<T[K]> }
      : T;
/** Domain outputs contain only data. Preserve shape, converting all bigint amounts to decimal strings. */
function serialise<T>(data: T): Serializable<T> {
  return JSON.parse(
    JSON.stringify(data, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  ) as Serializable<T>;
}
const defaultMeta: SnapshotMeta = { stale: false, ageMs: null, source: null, error: null };
const state = (empty: boolean, reason: string | null, meta: SnapshotMeta): VMState => ({
  ...meta,
  state: meta.error ? "error" : empty ? "empty" : "ready",
  empty,
  reason,
});

export interface PieTemplatesVM extends VMState {
  templates: (PieTemplate & { unavailable: { ticker: string; reason: string }[] })[];
}
export function buildPieTemplatesVM(
  buyable: ReadonlySet<string>,
  meta: SnapshotMeta = defaultMeta,
): PieTemplatesVM {
  return {
    ...state(false, null, meta),
    templates: PIE_TEMPLATES.map((template) => ({
      ...serialise(template),
      ...templateAvailability(template, buyable),
    })),
  };
}
export interface PieVM extends VMState {
  pieId: string;
  name: string;
  description: string;
  executable: boolean;
  currentValueE18: string;
  holdings: {
    ticker: string;
    valueE18: string;
    currentWeightBps: number;
    targetWeightBps: number;
    driftBps: number;
    fullyValued: boolean;
  }[];
  unavailable: RebalancePlan["unavailable"];
  excluded: RebalancePlan["excluded"];
}
export function buildPieVM(
  input: Pick<RebalanceInput, "template" | "holdings" | "prices" | "buyable">,
  meta: SnapshotMeta = defaultMeta,
): PieVM {
  const { template, holdings, prices, buyable } = input;
  const value = valuePie(template, holdings, prices);
  const availability = templateAvailability(template, buyable);
  const empty = !holdings.some(
    (h) => template.holdings.some((t) => t.ticker === h.ticker) && h.balanceTokens !== 0n,
  );
  return {
    ...state(
      empty,
      empty
        ? "Empty pie"
        : value.excluded.length
          ? `cannot value ${[...new Set(value.excluded.map((e) => e.ticker))].join(", ")}`
          : null,
      meta,
    ),
    pieId: template.id,
    name: template.name,
    description: template.description,
    executable: availability.executable && value.excluded.length === 0,
    currentValueE18: value.totalValueE18.toString(),
    holdings: value.before.map((h, i) => ({
      ticker: h.ticker,
      valueE18: h.valueE18.toString(),
      currentWeightBps: h.weightBps,
      targetWeightBps: template.holdings[i]!.targetWeightBps,
      driftBps: Math.abs(h.weightBps - template.holdings[i]!.targetWeightBps),
      fullyValued: !value.excluded.some((e) => e.ticker === h.ticker),
    })),
    unavailable: availability.unavailable,
    excluded: value.excluded,
  };
}
export interface RebalancePlanVM extends VMState {
  before: Serializable<RebalancePlan["before"]>;
  target: Serializable<RebalancePlan["target"]>;
  legs: Serializable<RebalancePlan["legs"]>;
  deferred: Serializable<RebalancePlan["deferred"]>;
  totals: Serializable<RebalancePlan["totals"]> | null;
  unavailable: RebalancePlan["unavailable"];
  excluded: RebalancePlan["excluded"];
  notes: string[];
  run: PieRun | null;
  partialState: ReturnType<typeof pieRunState> | null;
}
export function buildRebalancePlanVM(
  plan: RebalancePlan | null,
  run: PieRun | null = null,
  meta: SnapshotMeta = defaultMeta,
): RebalancePlanVM {
  return {
    ...state(
      (!plan || !plan.legs.length) && (!run || !run.legs.length),
      plan?.reason ?? (!plan ? "No plan available" : null),
      meta,
    ),
    before: serialise(plan?.before ?? []),
    target: serialise(plan?.target ?? []),
    legs: serialise(plan?.legs ?? []),
    deferred: serialise(plan?.deferred ?? []),
    totals: plan ? serialise(plan.totals) : null,
    unavailable: serialise(plan?.unavailable ?? []),
    excluded: serialise(plan?.excluded ?? []),
    notes: [...(plan?.notes ?? [])],
    run: run ? serialise(run) : null,
    partialState: run ? pieRunState(run) : null,
  };
}
export interface PiesViewModel extends VMState {
  templates: PieTemplatesVM;
  pie: PieVM | null;
  plan: RebalancePlanVM;
  notes: string[];
}
export interface LoadPiesOptions {
  /** Supply a verified session address in production; this loader never reads query parameters. */
  wallet?: string;
  store?: SnapshotStore;
  now?: number;
  pieId?: string;
  walletUsdtE18?: bigint;
  mode?: RebalanceInput["mode"];
  buyable?: ReadonlySet<string>;
  bestIssuer?: (ticker: string) => BuyIssuer | null;
  run?: PieRun;
  onWarn?: (message: string) => void;
}

/** Read existing WO-03 portfolio and collector snapshots only. No I/O beyond the injected store. */
export async function loadPies(options: LoadPiesOptions = {}): Promise<PiesViewModel> {
  const buyable = options.buyable ?? new Set(BUYABLE_TICKERS.map((t) => t.ticker));
  const result: PiesViewModel = {
    ...state(true, "Pies has no observations yet.", defaultMeta),
    templates: buildPieTemplatesVM(buyable),
    pie: null,
    plan: buildRebalancePlanVM(null),
    notes: [],
  };
  const warn = options.onWarn ?? ((message: string) => console.warn(message));
  if (!options.wallet || !options.store) return result;
  const used: Latest<unknown>[] = [];
  const meta = (): SnapshotMeta => ({
    stale: used.some((s) => s.stale),
    ageMs: used.length ? Math.max(...used.map((s) => s.ageMs)) : null,
    source: used.length ? [...new Set(used.map((s) => s.source))].join(", ") : null,
    error: null,
  });
  try {
    const template = PIE_TEMPLATES.find((t) => t.id === (options.pieId ?? "tech-trio"));
    if (!template) throw new Error("Unknown pie template");
    const now = options.now ?? Date.now();
    const portfolio = options.store.latest<{ holdings: PieHolding[] }>(
      "portfolio",
      options.wallet.toLowerCase(),
      { maxAgeMs: 300_000, now },
    );
    if (!portfolio) return result;
    used.push(portfolio);
    const registry = options.store.latest<RwaToken[]>("registry", "bsc", { maxAgeMs: 60_000, now });
    const priceSnapshot = options.store.latest<RwaPrice[]>("prices", "bsc", {
      maxAgeMs: 15_000,
      now,
    });
    if (registry) used.push(registry);
    const prices: Record<string, PiePrices[string]> = {};
    let usedPrices = false;
    for (const { ticker } of template.holdings) {
      const rows = registry?.data.filter((r) => r.underlyingTicker === ticker) ?? [];
      let found: PiePrices[string] = {
        usdPerShareE18: null,
        reason: "Registry/price reference unavailable",
      };
      for (const row of rows) {
        const priceRow = priceSnapshot?.data.find(
          (p) => p.tokenContractAddress.toLowerCase() === row.tokenContractAddress.toLowerCase(),
        );
        const primary = referencePerShare({
          referencePrice: priceRow?.referencePrice,
          tokenToShareRatio: row.tokenToShareRatio,
        });
        if (primary.usdPerShareE18 !== null) {
          found = primary;
          usedPrices = true;
          break;
        }
        const fallback = referencePerShare(row);
        if (fallback.usdPerShareE18 !== null) {
          const message = `${ticker}: price snapshot reference unavailable (${primary.reason}); using registry reference`;
          warn(message);
          result.notes.push(message);
          found = fallback;
          break;
        }
        found = fallback;
      }
      prices[ticker] = found;
    }
    if (usedPrices && priceSnapshot) used.push(priceSnapshot);
    for (const snap of used)
      if (snap.stale) {
        const message = `${snap.kind} snapshot is stale (${snap.ageMs} ms old)`;
        warn(message);
        result.notes.push(message);
      }
    const metadata = meta();
    const input = { template, holdings: portfolio.data.holdings, prices, buyable };
    result.pie = buildPieVM(input, metadata);
    result.templates = buildPieTemplatesVM(buyable, metadata);
    result.plan =
      options.walletUsdtE18 === undefined
        ? {
            ...buildRebalancePlanVM(null, options.run, metadata),
            reason: "Wallet USDT balance unavailable; no plan computed",
          }
        : buildRebalancePlanVM(
            rebalancePlan({
              ...input,
              walletUsdtE18: options.walletUsdtE18,
              mode: options.mode ?? "rebalance",
              bestIssuer: options.bestIssuer ?? (() => null),
            }),
            options.run,
            metadata,
          );
    return { ...result, ...state(result.pie.empty, result.pie.reason, metadata) };
  } catch (error) {
    const message = `Pies snapshot loading failed: ${errorMessage(error)}`;
    warn(message);
    const metadata = { ...meta(), error: message };
    return {
      ...result,
      ...state(result.empty, message, metadata),
      templates: buildPieTemplatesVM(buyable, metadata),
      plan: buildRebalancePlanVM(null, options.run, metadata),
      pie: result.pie ? { ...result.pie, state: "error", error: message } : null,
    };
  }
}
