import { existsSync } from "node:fs";
import type { Runtime } from "./runtime";
import type { ToolRegistry } from "./registry";

/** Other work orders export register(registry, engine). Missing files are expected until those PRs merge. */
export async function registerOptionalTools(
  registry: ToolRegistry,
  runtime: Runtime,
  load: (url: string) => Promise<{ register?: unknown }> = (url) => import(url),
  exists: (url: URL) => boolean = existsSync,
) {
  for (const file of ["get-receipt", "sell", "switch"]) {
    const url = new URL(`./tools/${file}.ts`, import.meta.url);
    if (!exists(url)) {
      runtime.onWarn(`Optional ${file} tool is not installed.`);
      continue;
    }
    const module = await load(url.href);
    if (typeof module.register !== "function")
      throw new Error(`Optional ${file} tool must export register(registry, engine).`);
    await module.register(registry, runtime.engine);
  }
}
