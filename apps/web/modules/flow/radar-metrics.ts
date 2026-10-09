import type { SnapshotStore } from "@tally/modkit";

export interface RadarReadMetrics {
  tokens: Set<string>;
  bytesDecoded: number;
}

/** Count decoded snapshot bytes with modkit's bigint/string encoding; never log contents. */
export function measureRadarStore(store: SnapshotStore, metrics: RadarReadMetrics): SnapshotStore {
  return {
    ...store,
    latest<T>(kind: string, key: string, options: { maxAgeMs: number; now?: number }) {
      if (["radar", "flow-aggregate", "flow-ghost"].includes(kind)) metrics.tokens.add(key);
      const row = store.latest<T>(kind, key, options);
      if (row) {
        const snapshot = {
          kind: row.kind,
          key: row.key,
          data: row.data,
          source: row.source,
          observedAt: row.observedAt,
          ...(row.notes ? { notes: row.notes } : {}),
        };
        metrics.bytesDecoded += Buffer.byteLength(
          JSON.stringify(snapshot, (_key, value: unknown) =>
            typeof value === "bigint"
              ? `$tally:bigint:${value}`
              : typeof value === "string" && value.startsWith("$tally:")
                ? `$tally:string:${value}`
                : value,
          ),
        );
      }
      return row;
    },
  };
}
