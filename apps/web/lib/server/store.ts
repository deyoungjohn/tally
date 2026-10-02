import { appendFile, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Small append-only JSONL files under TALLY_DATA_DIR (fills, region declarations). SQLite replaces this later (blueprint §14). */
function dir(): string | undefined {
  if (process.env.TALLY_DATA_DIR) return process.env.TALLY_DATA_DIR;
  if (process.env.TALLY_FIXTURES === "1") return path.join(os.tmpdir(), "tally-dev-data");
  return undefined;
}

let warned = false;
export async function appendJsonl(name: string, row: unknown): Promise<boolean> {
  const d = dir();
  if (!d) {
    if (!warned)
      console.warn("TALLY_DATA_DIR is not set: fills and declarations are not being stored");
    warned = true;
    return false;
  }
  await mkdir(d, { recursive: true });
  await appendFile(path.join(d, name), JSON.stringify(row) + "\n");
  return true;
}

export async function readJsonl<T>(name: string, limit = 50): Promise<T[]> {
  const d = dir();
  if (!d) return [];
  try {
    const text = await readFile(path.join(d, name), "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((l) => JSON.parse(l) as T);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
