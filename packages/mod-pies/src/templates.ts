import tech from "../templates/tech-trio.json";
import index from "../templates/index-core.json";
import growth from "../templates/growth-five.json";
import mag7 from "../templates/mag7-preview.json";
import type { MissingFact, PieTemplate } from "./types";

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Hand-written guards: validation applies to shipped and caller-supplied templates. */
export function validateTemplate(value: unknown): PieTemplate {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    typeof value.description !== "string" ||
    !value.description.trim() ||
    typeof value.executable !== "boolean" ||
    !Array.isArray(value.holdings) ||
    !value.holdings.length
  )
    throw new Error("Invalid pie template");
  const seen = new Set<string>();
  const holdings = value.holdings.map((h: unknown) => {
    if (
      !record(h) ||
      typeof h.ticker !== "string" ||
      !/^[A-Z0-9.]{1,10}$/.test(h.ticker) ||
      typeof h.targetWeightBps !== "number" ||
      !Number.isInteger(h.targetWeightBps) ||
      h.targetWeightBps < 0 ||
      h.targetWeightBps > 10000
    )
      throw new Error("Invalid ticker or target weight");
    if (seen.has(h.ticker)) throw new Error(`Duplicate ticker ${h.ticker}`);
    seen.add(h.ticker);
    return { ticker: h.ticker, targetWeightBps: h.targetWeightBps };
  });
  if (holdings.reduce((n, h) => n + h.targetWeightBps, 0) !== 10000)
    throw new Error("Template weights must sum to exactly 10000 bps");
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    executable: value.executable,
    holdings,
  };
}
export const PIE_TEMPLATES: readonly PieTemplate[] = [tech, index, growth, mag7].map(
  validateTemplate,
);

/** Basket buying is separate from the four existing rebalance templates. */
export interface BasketTemplate extends PieTemplate {
  issuer: "bstock";
}
export const BIG_TECH: BasketTemplate = {
  ...validateTemplate({
    id: "big-tech",
    name: "Big Tech",
    description: "Five of the largest US tech companies",
    executable: true,
    holdings: ["NVDA", "AAPL", "GOOGL", "MSFT", "META"].map((ticker) => ({
      ticker,
      targetWeightBps: 2000,
    })),
  }),
  issuer: "bstock",
};
const even = (tickers: string[]) => {
  // Weights in basis points that always add up to 10000: the first few take the remainder.
  const base = Math.floor(10000 / tickers.length);
  const extra = 10000 - base * tickers.length;
  return tickers.map((ticker, i) => ({ ticker, targetWeightBps: base + (i < extra ? 1 : 0) }));
};
/** Visible on the Baskets page but not buyable yet (`executable: false`). */
export const MAG_7: BasketTemplate = {
  ...validateTemplate({
    id: "mag-7",
    name: "Mag 7",
    description: "The seven largest US tech companies",
    executable: false,
    holdings: even(["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"]),
  }),
  issuer: "bstock",
};
export const AI_CHIPS: BasketTemplate = {
  ...validateTemplate({
    id: "ai-chips",
    name: "AI Chips",
    description: "The companies that make the chips behind AI",
    executable: false,
    holdings: even(["NVDA", "AMD", "AVGO", "TSM", "MU"]),
  }),
  issuer: "bstock",
};
export const ETFS: BasketTemplate = {
  ...validateTemplate({
    id: "etfs",
    name: "ETFs",
    description: "Broad US market funds in one basket",
    executable: false,
    holdings: even(["SPY", "QQQ", "VTI", "IWM", "DIA"]),
  }),
  issuer: "bstock",
};
export const BASKET_TEMPLATES: readonly BasketTemplate[] = [BIG_TECH, MAG_7, AI_CHIPS, ETFS];

export function templateAvailability(
  template: PieTemplate,
  buyable: ReadonlySet<string>,
): {
  executable: boolean;
  unavailable: MissingFact[];
} {
  const unavailable = template.holdings
    .filter((h) => !buyable.has(h.ticker))
    .map((h) => ({
      ticker: h.ticker,
      reason: `${h.ticker} is not buyable`,
    }));
  return { executable: template.executable && unavailable.length === 0, unavailable };
}
