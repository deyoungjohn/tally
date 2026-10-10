import {
  BASKET_TEMPLATES,
  MIN_BASKET_LEG,
  basketBuyPlan,
  type BasketTemplate,
  type BasketBuyPlan,
} from "@tally/mod-pies";
import { isTokenBuyable } from "../../lib/tickers";
import type { PieBuyRun } from "../../components/pies/use-pie-run-state";
import type { SnapshotMeta } from "./view-model";

type Serializable<T> = T extends bigint
  ? string
  : T extends readonly (infer U)[]
    ? Serializable<U>[]
    : T extends object
      ? { [K in keyof T]: Serializable<T[K]> }
      : T;
const serialise = <T>(data: T): Serializable<T> =>
  JSON.parse(
    JSON.stringify(data, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  ) as Serializable<T>;
const defaultMeta: SnapshotMeta = { stale: false, ageMs: null, source: null, error: null };

export type BasketBuyPlanVM = Serializable<BasketBuyPlan> & {
  legs: (Serializable<BasketBuyPlan["legs"][number]> & {
    approximateSharesE18: string | null;
    sharesReason: string | null;
  })[];
};
export interface BasketVM {
  id: string;
  name: string;
  description: string;
  minimumBudgetUsdt: string;
  /** False for a basket that is shown but cannot be bought yet. */
  available: boolean;
  tokens: {
    ticker: string;
    symbol: string;
    issuer: "bstock";
    weightBps: number;
    executable: boolean;
    reason: string | null;
  }[];
}
export interface PiesPageVM extends SnapshotMeta {
  state: "ready" | "empty" | "error";
  empty: boolean;
  reason: string | null;
  fixtures: boolean;
  label: "Fixture data" | null;
  baskets: BasketVM[];
  selectedBasketId: string | null;
  plan: BasketBuyPlanVM | null;
  run: PieBuyRun | null;
}
export interface PiesPageOptions {
  templates?: readonly BasketTemplate[];
  budgetUsdt?: bigint;
  weightsBps?: Readonly<Record<string, number>>;
  enabled?: ReadonlySet<string>;
  pieId?: string;
  pricesE18?: Readonly<Record<string, bigint | null>>;
  meta?: SnapshotMeta;
  fixtures?: boolean;
  run?: PieBuyRun | null;
  wallet?: string;
}
/** Template/plan projection only. Prices, availability and run state are data inputs. */
export function buildPiesPageVM(options: PiesPageOptions = {}): PiesPageVM {
  const templates = options.templates ?? BASKET_TEMPLATES;
  const enabled =
    options.enabled ??
    new Set(
      templates.flatMap((template) =>
        template.holdings
          .filter((holding) => isTokenBuyable(holding.ticker, "bstock"))
          .map((holding) => holding.ticker),
      ),
    );
  const meta = options.meta ?? { ...defaultMeta, source: "Fixed basket templates" };
  const baskets = templates.map((template): BasketVM => {
    const tokens = template.holdings.map((holding) => ({
      ticker: holding.ticker,
      symbol: `${holding.ticker}B`,
      issuer: "bstock" as const,
      weightBps: holding.targetWeightBps,
      executable: template.executable && enabled.has(holding.ticker),
      reason: !template.executable
        ? "Preview basket; not executable"
        : enabled.has(holding.ticker)
          ? null
          : `${holding.ticker}B isn’t enabled in Tally yet`,
    }));
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      available: template.executable,
      minimumBudgetUsdt: (
        MIN_BASKET_LEG * BigInt(tokens.filter((token) => token.executable).length)
      ).toString(),
      tokens,
    };
  });
  const selected = templates.find(
    (template) => template.id === (options.pieId ?? templates[0]?.id),
  );
  const result: PiesPageVM = {
    ...meta,
    state: meta.error ? "error" : baskets.length ? "ready" : "empty",
    empty: !baskets.length,
    reason: baskets.length ? null : "No baskets are available",
    fixtures: options.fixtures === true,
    label: options.fixtures ? "Fixture data" : null,
    baskets,
    selectedBasketId: selected?.id ?? null,
    plan: null,
    run:
      options.run &&
      (!options.wallet || options.run.wallet.toLowerCase() === options.wallet.toLowerCase())
        ? serialise(options.run)
        : null,
  };
  if (options.budgetUsdt === undefined || meta.error) return result;
  try {
    if (!selected) throw new Error("Unknown basket");
    const plan = basketBuyPlan({
      template: selected,
      budgetUsdt: options.budgetUsdt,
      weightsBps: options.weightsBps,
      enabled,
    });
    const selectedBasket = result.baskets.find((basket) => basket.id === selected.id);
    if (selectedBasket) {
      for (const token of selectedBasket.tokens) {
        token.weightBps = plan.legs.find((leg) => leg.ticker === token.ticker)!.weightBps;
      }
      selectedBasket.minimumBudgetUsdt = (
        MIN_BASKET_LEG *
        BigInt(
          selectedBasket.tokens.filter((token) => token.executable && token.weightBps > 0).length,
        )
      ).toString();
    }
    const serial = serialise(plan);
    result.plan = {
      ...serial,
      legs: plan.legs.map((leg) => {
        const price = options.pricesE18?.[leg.ticker];
        return {
          ...serialise(leg),
          approximateSharesE18:
            price && price > 0n ? ((leg.amountUsdt * 10n ** 18n) / price).toString() : null,
          sharesReason: price && price > 0n ? null : "No per-share price snapshot available",
        };
      }),
    };
  } catch (error) {
    result.state = "error";
    result.error = error instanceof Error ? error.message : "Basket plan is unavailable";
    result.reason = result.error;
  }
  return result;
}
