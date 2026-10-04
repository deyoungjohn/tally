import { existsSync } from "node:fs";
import type { Runtime } from "./runtime";
import type { ToolRegistry } from "./registry";
import { safeText } from "./output";

/** Other work orders export register(registry, engine). Missing files are expected until those PRs merge. */
export async function registerOptionalTools(
  registry: ToolRegistry,
  runtime: Runtime,
  load: (url: string) => Promise<{ register?: unknown }> = (url) => import(url),
  exists: (url: URL) => boolean = existsSync,
) {
  for (const file of ["get-receipt", "sell", "switch"]) {
    const url = new URL(`./tools/${file}.ts`, import.meta.url);
    try {
      if (!exists(url)) {
        runtime.onWarn(safeText(`Optional ${file} tool is not installed.`));
        continue;
      }
      const module = await load(url.href);
      if (typeof module.register !== "function")
        throw new Error("Must export register(registry, engine).");
      await module.register(registry, runtime.engine);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown module failure.";
      runtime.onWarn(safeText(`Optional ${file} tool was skipped: ${reason}`));
    }
  }
}
