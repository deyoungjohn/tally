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
