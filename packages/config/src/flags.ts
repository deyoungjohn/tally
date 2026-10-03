export const MODULE_NAMES = [
  "receipts",
  "quality",
  "statement",
  "flow",
  "guardian",
  "autopilot",
  "sell",
  "switch",
  "pies",
  "rewards",
] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];

/** Only an explicit 1 enables a module; environment values never go to the browser. */
export function flags(
  env: Record<string, string | undefined> = process.env,
): Record<ModuleName, boolean> {
  return Object.fromEntries(
    MODULE_NAMES.map((name) => [name, env[`FEATURE_${name.toUpperCase()}`] === "1"]),
  ) as Record<ModuleName, boolean>;
}
