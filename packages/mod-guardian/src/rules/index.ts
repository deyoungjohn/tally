export * from "./interface";
export * from "./paused";
export * from "./share-count";
export * from "./grade-drop";
export * from "./ghost";
export * from "./price-threshold";
export * from "./earnings";

import { PausedRule } from "./paused";
import { ShareCountRule } from "./share-count";
import { GradeDropRule } from "./grade-drop";
import { GhostRule } from "./ghost";
import { PriceThresholdRule } from "./price-threshold";
import { EarningsRule } from "./earnings";
import type { Rule } from "./interface";

export function createDefaultRules(): Rule[] {
  return [
    new PausedRule(),
    new ShareCountRule(),
    new GradeDropRule(),
    new GhostRule(),
    new PriceThresholdRule(),
    new EarningsRule(),
  ];
}

export const ALL_RULES: readonly Rule[] = createDefaultRules();
