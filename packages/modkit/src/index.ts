import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ModuleName } from "@tally/config";

// Load the native builtin directly: Vitest 2's Vite resolver predates node:sqlite.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

export interface Snapshot<T> {
  kind: string;
  key: string;
  data: T;
  source: string;
  observedAt: number;
  notes?: string[];
}
export interface Latest<T> extends Snapshot<T> {
  ageMs: number;
  stale: boolean;
}
export interface SnapshotStore {
  put<T>(snapshot: Snapshot<T>): void;
  latest<T>(kind: string, key: string, opts: { maxAgeMs: number; now?: number }): Latest<T> | null;
  /** Oldest first, inclusive of sinceMs. */
  history<T>(kind: string, key: string, sinceMs: number, limit?: number): Snapshot<T>[];
}
export type JobName = ModuleName | `collect-${string}`;
export interface HealthRow {
  module: JobName;
  ok: boolean;
  lastRunAt: number;
  lastOkAt?: number;
  lastError?: string;
}
export interface ModuleHealth {
  report(module: JobName, result: { ok: boolean; error?: string; now?: number }): void;
  get(module: JobName): HealthRow | null;
  all(): HealthRow[];
}
export interface OpenSnapshotStore extends SnapshotStore {
  health: ModuleHealth;
  close(): void;
}

// Escape reserved strings too, so ordinary data cannot accidentally revive as a bigint.
const PREFIX = "$tally:";
function encode(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "bigint"
      ? `${PREFIX}bigint:${v}`
      : typeof v === "string" && v.startsWith(PREFIX)
        ? `${PREFIX}string:${v}`
        : v,
  );
}
function decode<T>(value: string): T {
  return JSON.parse(value, (_key, v: unknown) => {
    if (typeof v !== "string") return v;
    if (v.startsWith(`${PREFIX}string:`)) return v.slice(`${PREFIX}string:`.length);
    if (v.startsWith(`${PREFIX}bigint:`)) return BigInt(v.slice(`${PREFIX}bigint:`.length));
    return v;
  }) as T;
}

/** Shared by independently running workers and the web server; WAL permits concurrent readers. */
export function openStore(
  path = join(
    process.env.TALLY_DATA_DIR ?? join(homedir(), ".local", "share", "tally"),
    "tally.db",
  ),
): OpenSnapshotStore {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL, key TEXT NOT NULL,
      payload TEXT NOT NULL, observed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS snapshots_lookup ON snapshots(kind, key, observed_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS module_health (module TEXT PRIMARY KEY, payload TEXT NOT NULL);
  `);
  const health: ModuleHealth = {
    report(module, result) {
      const now = result.now ?? Date.now();
      const previous = health.get(module);
      const row: HealthRow = {
        module,
        ok: result.ok,
        lastRunAt: now,
        lastOkAt: result.ok ? now : previous?.lastOkAt,
        lastError: result.ok ? undefined : (result.error ?? "Job failed without an error message"),
      };
      db.prepare(
        "INSERT INTO module_health(module,payload) VALUES (?,?) ON CONFLICT(module) DO UPDATE SET payload=excluded.payload",
      ).run(module, encode(row));
    },
    get(module) {
      const row = db.prepare("SELECT payload FROM module_health WHERE module=?").get(module);
      return row ? decode<HealthRow>(String(row.payload)) : null;
    },
    all() {
      return db
        .prepare("SELECT payload FROM module_health ORDER BY module")
        .all()
        .map((r) => decode<HealthRow>(String(r.payload)));
    },
  };
  return {
    health,
    close: () => db.close(),
    put(snapshot) {
      if (!Number.isFinite(snapshot.observedAt)) throw new RangeError("observedAt must be finite");
      db.prepare("INSERT INTO snapshots(kind,key,payload,observed_at) VALUES (?,?,?,?)").run(
        snapshot.kind,
        snapshot.key,
        encode(snapshot),
        snapshot.observedAt,
      );
    },
    latest<T>(kind: string, key: string, opts: { maxAgeMs: number; now?: number }) {
      if (!Number.isFinite(opts.maxAgeMs) || opts.maxAgeMs < 0)
        throw new RangeError("maxAgeMs must be nonnegative and finite");
      const row = db
        .prepare(
          "SELECT payload FROM snapshots WHERE kind=? AND key=? ORDER BY observed_at DESC,id DESC LIMIT 1",
        )
        .get(kind, key);
      if (!row) return null;
      const snapshot = decode<Snapshot<T>>(String(row.payload));
      const ageMs = Math.max(0, (opts.now ?? Date.now()) - snapshot.observedAt);
      return { ...snapshot, ageMs, stale: ageMs > opts.maxAgeMs };
    },
    history<T>(kind: string, key: string, sinceMs: number, limit = 1000) {
      if (!Number.isInteger(limit) || limit < 0)
        throw new RangeError("limit must be a nonnegative integer");
      return db
        .prepare(
          "SELECT payload FROM snapshots WHERE kind=? AND key=? AND observed_at>=? ORDER BY observed_at,id LIMIT ?",
        )
        .all(kind, key, sinceMs, limit)
        .map((r) => decode<Snapshot<T>>(String(r.payload)));
    },
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export async function withFallback<T>(
  steps: { name: string; run: () => Promise<T> }[],
  onWarn: (message: string) => void,
): Promise<{ value: T; source: string }> {
  const failures: Error[] = [];
  for (const step of steps) {
    try {
      return { value: await step.run(), source: step.name };
    } catch (error) {
      const kind =
        error instanceof Error && "kind" in error
          ? String(error.kind)
          : error instanceof Error
            ? error.name
            : typeof error;
      const message = `${step.name} failed (${kind}): ${errorMessage(error)}`;
      onWarn(message);
      failures.push(new Error(message, { cause: error }));
    }
  }
  throw new AggregateError(
    failures,
    `All sources failed: ${failures.map((e) => e.message).join("; ") || "no sources supplied"}`,
  );
}
