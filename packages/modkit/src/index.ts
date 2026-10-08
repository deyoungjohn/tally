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
  listLatest<T>(
    kind: string,
    opts: { maxAgeMs: number; now?: number; limit?: number },
  ): Latest<T>[];
  /** Deletes expired hints, including their last row; never deletes evidence. */
  expire(opts: { kind: string; olderThanMs: number }): number;
  /** Oldest first, inclusive of sinceMs. */
  history<T>(kind: string, key: string, sinceMs: number, limit?: number): Snapshot<T>[];
  /** Cutoff is an absolute timestamp. Latest observations and evidence are protected by default. */
  prune(opts: {
    kind?: string;
    olderThanMs: number;
    keepLatest?: number;
    excludeKinds?: readonly string[];
  }): number;
}
export type JobName = ModuleName | `collect-${string}` | "prune";
export const EVIDENCE_SNAPSHOT_KINDS = [
  "receipt",
  "receipts",
  "decision",
  "decisions",
  "alert",
  "alerts",
] as const;
export interface HealthRow {
  module: JobName;
  ok: boolean;
  lastRunAt: number;
  lastOkAt?: number;
  lastError?: string;
  intervalMs?: number;
}
export interface ModuleHealth {
  report(
    module: JobName,
    result: { ok: boolean; error?: string; now?: number; intervalMs?: number },
  ): void;
  get(module: JobName): HealthRow | null;
  all(): HealthRow[];
}

export interface ModuleHealthState {
  health: HealthRow | null;
  degraded: boolean;
  stale: boolean;
  ageMs: number | null;
  reason: string | null;
}

/** Health freshness follows each job's cadence; old rows without a cadence retain the 120s policy. */
export function moduleHealthState(health: HealthRow | null, now = Date.now()): ModuleHealthState {
  const interval = health?.intervalMs;
  const maxAge =
    interval !== undefined && Number.isFinite(interval) && interval > 0 ? 3 * interval : 120_000;
  const stale = health !== null && now - health.lastRunAt > maxAge;
  return {
    health,
    degraded: !health?.ok || stale,
    stale,
    ageMs: health?.lastOkAt === undefined ? null : Math.max(0, now - health.lastOkAt),
    reason:
      health?.lastOkAt === undefined
        ? "No successful update yet"
        : !health.ok
          ? (health.lastError ?? "Latest update failed")
          : stale
            ? "Worker update is overdue"
            : null,
  };
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
    PRAGMA busy_timeout = 30000;
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
      if (
        result.intervalMs !== undefined &&
        (!Number.isFinite(result.intervalMs) || result.intervalMs <= 0)
      )
        throw new RangeError("intervalMs must be positive and finite");
      const now = result.now ?? Date.now();
      const previous = health.get(module);
      const row: HealthRow = {
        module,
        ok: result.ok,
        lastRunAt: now,
        lastOkAt: result.ok ? now : previous?.lastOkAt,
        lastError: result.ok ? undefined : (result.error ?? "Job failed without an error message"),
        intervalMs: result.intervalMs ?? previous?.intervalMs,
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
      const payload = encode(snapshot);
      // Single SQL statement makes the latest-row check and insertion atomic across writers.
      db.prepare(
        `INSERT INTO snapshots(kind,key,payload,observed_at)
        SELECT ?,?,?,? WHERE NOT EXISTS (
          SELECT 1 FROM (SELECT payload, observed_at FROM snapshots WHERE kind=? AND key=? ORDER BY observed_at DESC,id DESC LIMIT 1)
          WHERE payload=? AND observed_at=?
        )`,
      ).run(
        snapshot.kind,
        snapshot.key,
        payload,
        snapshot.observedAt,
        snapshot.kind,
        snapshot.key,
        payload,
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
    listLatest<T>(kind: string, opts: { maxAgeMs: number; now?: number; limit?: number }) {
      const limit = opts.limit ?? 200;
      if (!Number.isInteger(limit) || limit < 0 || limit > 1000)
        throw new RangeError("limit must be an integer from 0 to 1000");
      if (!Number.isFinite(opts.maxAgeMs) || opts.maxAgeMs < 0)
        throw new RangeError("maxAgeMs must be nonnegative and finite");
      const now = opts.now ?? Date.now();
      if (!Number.isFinite(now)) throw new RangeError("now must be finite");
      return db
        .prepare(
          `SELECT payload FROM (
        SELECT payload, observed_at, id, ROW_NUMBER() OVER (
          PARTITION BY key ORDER BY observed_at DESC,id DESC
        ) AS position FROM snapshots WHERE kind=?
      ) WHERE position=1 ORDER BY observed_at DESC,id DESC LIMIT ?`,
        )
        .all(kind, limit)
        .map((row) => {
          const snapshot = decode<Snapshot<T>>(String(row.payload));
          const ageMs = Math.max(0, now - snapshot.observedAt);
          return { ...snapshot, ageMs, stale: ageMs > opts.maxAgeMs };
        });
    },
    expire({ kind, olderThanMs }) {
      if ((EVIDENCE_SNAPSHOT_KINDS as readonly string[]).includes(kind))
        throw new Error("Cannot expire protected evidence");
      if (!Number.isFinite(olderThanMs)) throw new RangeError("olderThanMs must be finite");
      return Number(
        db.prepare("DELETE FROM snapshots WHERE kind=? AND observed_at<?").run(kind, olderThanMs)
          .changes,
      );
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
    prune({ kind, olderThanMs, keepLatest = 1, excludeKinds = EVIDENCE_SNAPSHOT_KINDS }) {
      if (!Number.isFinite(olderThanMs)) throw new RangeError("olderThanMs must be finite");
      if (!Number.isInteger(keepLatest) || keepLatest < 1)
        throw new RangeError("keepLatest must be at least 1");
      const protectedKinds = [...new Set([...EVIDENCE_SNAPSHOT_KINDS, ...excludeKinds])];
      const filter = [
        kind === undefined ? "1=1" : "kind=?",
        `kind NOT IN (${protectedKinds.map(() => "?").join(",")})`,
      ].join(" AND ");
      const params = [...(kind === undefined ? [] : [kind]), ...protectedKinds];
      const statement = db.prepare(
        `DELETE FROM snapshots WHERE id IN (
        SELECT old.id FROM snapshots AS old WHERE ${filter} AND old.observed_at < ?
          AND old.id NOT IN (
            SELECT id FROM snapshots WHERE kind=old.kind AND key=old.key
            ORDER BY observed_at DESC,id DESC LIMIT ?
          ) LIMIT 200
      )`,
      );
      // Indexed latest-row lookups avoid scanning/ranking the whole history under the write lock.
      // Each statement autocommits before pausing, letting other processes acquire the writer lock.
      const pause = new Int32Array(new SharedArrayBuffer(4));
      let total = 0;
      for (;;) {
        const deleted = Number(statement.run(...params, olderThanMs, keepLatest).changes);
        if (deleted === 0) return total;
        total += deleted;
        Atomics.wait(pause, 0, 0, 1);
      }
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
