import { E18, formatUnits } from "@tally/core";
import { validateTemplate, type BasketTemplate } from "./templates";

export const USDT_CENT = E18 / 100n;
export const MIN_BASKET_LEG = 6n * E18;
export interface BasketBuyLeg {
  id: string;
  sequence: number;
  ticker: string;
  issuer: "bstock";
  symbol: string;
  weightBps: number;
  amountUsdt: bigint;
  executable: boolean;
  reason: string | null;
}
export interface BasketBuyPlan {
  templateId: string;
  budgetUsdt: bigint;
  minLegUsdt: bigint;
  legs: BasketBuyLeg[];
  deferred: BasketBuyLeg[];
  totalUsdt: bigint;
  unspentUsdt: bigint;
  reason: string | null;
}
export interface BasketBuyInput {
  template: BasketTemplate;
  /** USDT in bigint 1e18 units; no network or wallet access. */
  budgetUsdt: bigint;
  weightsBps?: Readonly<Record<string, number>>;
  minLegUsdt?: bigint;
  /** Tickers enabled specifically as bStock, supplied by the web layer. */
  enabled: ReadonlySet<string>;
}

export function basketBuyPlan(input: BasketBuyInput): BasketBuyPlan {
  const template = validateTemplate(input.template);
  if (input.template.issuer !== "bstock") throw new Error("Basket buys support bStock only");
  if (typeof input.budgetUsdt !== "bigint" || input.budgetUsdt < 0n)
    throw new Error("Budget must be a non-negative bigint USDT amount");
  const minLegUsdt = input.minLegUsdt ?? MIN_BASKET_LEG;
  if (typeof minLegUsdt !== "bigint" || minLegUsdt < MIN_BASKET_LEG)
    throw new Error("Minimum basket leg must be at least 6 USDT");
  const tickers = new Set(template.holdings.map((holding) => holding.ticker));
  if (
    input.weightsBps &&
    (Object.keys(input.weightsBps).length !== tickers.size ||
      Object.keys(input.weightsBps).some((ticker) => !tickers.has(ticker)))
  )
    throw new Error("Provide a weight for every basket ticker, with no extra tickers");
  const weights = template.holdings.map((holding) =>
    input.weightsBps ? input.weightsBps[holding.ticker] : holding.targetWeightBps,
  );
  if (
    weights.some((weight) => !Number.isInteger(weight) || weight! < 0 || weight! > 10000) ||
    weights.reduce<number>((total, weight) => total + weight!, 0) !== 10000
  )
    throw new Error("Basket weights must sum to exactly 10000 bps");
  const legs = template.holdings.map((holding, index): BasketBuyLeg => {
    const weightBps = weights[index]!;
    const amountUsdt = ((input.budgetUsdt * BigInt(weightBps)) / 10000n / USDT_CENT) * USDT_CENT;
    const reason = !template.executable
      ? "This basket is a preview; it is not executable"
      : !input.enabled.has(holding.ticker)
        ? `${holding.ticker}B isn’t enabled in Tally yet`
        : amountUsdt < minLegUsdt
          ? `Leg is below the ${formatUnits(minLegUsdt, 18, 2)} USDT minimum`
          : null;
    return {
      id: `${template.id}:${index + 1}:${holding.ticker}:bstock`,
      sequence: index + 1,
      ticker: holding.ticker,
      issuer: "bstock",
      symbol: `${holding.ticker}B`,
      weightBps,
      amountUsdt,
      executable: reason === null,
      reason,
    };
  });
  const totalUsdt = legs
    .filter((leg) => leg.executable)
    .reduce((total, leg) => total + leg.amountUsdt, 0n);
  return {
    templateId: template.id,
    budgetUsdt: input.budgetUsdt,
    minLegUsdt,
    legs,
    deferred: legs.filter((leg) => !leg.executable),
    totalUsdt,
    unspentUsdt: input.budgetUsdt - totalUsdt,
    reason:
      totalUsdt === 0n ? "No executable buy legs; deferred amounts remain in your wallet" : null,
  };
}
