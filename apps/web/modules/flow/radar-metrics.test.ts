import { expect, it } from "vitest";
import { openStore } from "@tally/modkit";
import { measureRadarStore } from "./radar-metrics";

it("counts UTF-8 decoded snapshot bytes using the store's escaped bigint encoding", () => {
  const store = openStore(":memory:");
  const metrics = { tokens: new Set<string>(), bytesDecoded: 0 };
  const snapshot = {
    kind: "radar",
    key: "token",
    data: { shares: 10n, reason: "$tally:bigint:1", label: "é" },
    source: "fixture",
    observedAt: 123,
    notes: ["✓"],
  };
  try {
    store.put(snapshot);
    const measured = measureRadarStore(store, metrics);
    expect(
      measured.latest<typeof snapshot.data>("radar", "token", { maxAgeMs: 1000, now: 123 })?.data,
    ).toEqual(snapshot.data);
    const expected = {
      ...snapshot,
      data: {
        ...snapshot.data,
        shares: "$tally:bigint:10",
        reason: "$tally:string:$tally:bigint:1",
      },
    };
    expect(metrics.bytesDecoded).toBe(Buffer.byteLength(JSON.stringify(expected)));
    measured.latest("radar", "missing", { maxAgeMs: 1000, now: 123 });
    expect(metrics.tokens.size).toBe(2);
    expect(metrics.bytesDecoded).toBe(Buffer.byteLength(JSON.stringify(expected)));
  } finally {
    store.close();
  }
});
