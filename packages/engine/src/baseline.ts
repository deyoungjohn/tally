import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BaselineStore } from "@tally/binance";
import { formatUnits, parseDecimal, type RegistryToken } from "@tally/core";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The committed seed: Ondo multipliers from the 2026-09-30 public snapshot (see scripts/seed-ondo-baseline.ts). Never written at runtime. */
export const SEED_PATH = join(HERE, "..", "..", "..", "data", "ondo-multiplier-baseline.json");
const REFRESH_MS = 24 * 60 * 60 * 1000;

interface Entry {
  symbol: string;
  /** Plain decimal, exactly as the API gives it ("1.0017152487959898"). */
  value: string;
  /** ISO time the value was last seen. */
  seenAt: string;
}
interface BaselineFile {
  schema: 1;
  source: string;
  entries: Record<string, Entry>;
}

export interface JsonBaselineOptions {
  /** Runtime copy. Created from the seed on first use. Omit for a read-only store that never writes (fixtures, tests, dev). */
  path?: string;
  seedPath?: string;
  onWarn?: (message: string) => void;
}

/**
 * Last accepted Ondo multiplier per token (blueprint §7.3), in a JSON file until SQLite arrives. Only readings that
 * passed the bounds check are ever recorded (the engine decides; this store just persists). Writes are atomic
 * (temp file + rename) and serialised, and skipped when nothing changed (a refresh of `seenAt` at most once a day).
 */
export class JsonBaselineStore implements BaselineStore {
  private readonly file: BaselineFile;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly o: JsonBaselineOptions = {}) {
    const seed = o.seedPath ?? SEED_PATH;
    const source = o.path && existsSync(o.path) ? o.path : seed;
    this.file = JSON.parse(readFileSync(source, "utf8")) as BaselineFile;
    if (this.file.schema !== 1) throw new Error(`unsupported baseline schema in ${source}`);
    if (o.path && source === seed) this.persist(); // first run: create the runtime copy from the committed seed
  }

  get writable(): boolean {
    return this.o.path !== undefined;
  }

  get size(): number {
    return Object.keys(this.file.entries).length;
  }

  get(address: string): { value: bigint; at: number } | undefined {
    const e = this.file.entries[address.toLowerCase()];
    return e ? { value: parseDecimal(e.value, 18), at: Date.parse(e.seenAt) } : undefined;
  }

  async record(token: RegistryToken, value: bigint, at: number): Promise<void> {
    if (!this.writable) return;
    const key = token.address.toLowerCase();
    const text = formatUnits(value, 18);
    const prev = this.file.entries[key];
    if (prev && prev.value === text && at - Date.parse(prev.seenAt) < REFRESH_MS) return;
    this.file.entries[key] = {
      symbol: token.symbol,
      value: text,
      seenAt: new Date(at).toISOString(),
    };
    this.chain = this.chain
      .then(() => this.persist())
      .catch((e) =>
        this.o.onWarn?.(`baseline write failed: ${e instanceof Error ? e.message : String(e)}`),
      );
    await this.chain;
  }

  private persist(): void {
    const path = this.o.path!;
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(this.file, null, 2)}\n`);
    renameSync(tmp, path);
  }
}

/** Live engines write to TALLY_BASELINE_PATH, or `$TALLY_DATA_DIR/ondo-multiplier-baseline.json`; otherwise read-only (never touches the repo). */
export function baselineFromEnv(
  env: Record<string, string | undefined>,
  onWarn?: (m: string) => void,
): JsonBaselineStore {
  const path =
    env.TALLY_BASELINE_PATH ||
    (env.TALLY_DATA_DIR ? join(env.TALLY_DATA_DIR, "ondo-multiplier-baseline.json") : undefined);
  if (!path)
    onWarn?.(
      "Ondo baseline is read-only: set TALLY_DATA_DIR (e.g. /var/lib/tally) so accepted readings are saved",
    );
  return new JsonBaselineStore({ path, onWarn });
}
