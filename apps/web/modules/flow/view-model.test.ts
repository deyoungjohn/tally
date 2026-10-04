import { expect, it, vi } from "vitest";
import { gradeIntegrity, E18 } from "@tally/core";
import { openStore } from "@tally/modkit";
import {
  aggregateFlow,
  extendIntegrity,
  ghostInput,
  WINDOWS,
  type FlowSnapshot,
  type FlowToken,
} from "@tally/mod-flow";
import { loadFlow, loadRadar, displayFlow, type RadarGradeSnapshot } from "./view-model";
vi.mock("@/components/module-boundary", () => ({ ModuleBoundary: () => null }));
// plain.tsx uses Next's JSX transform; pass React to Vitest's classic JSX transform.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RadarContent, FlowContent } from "./plain";
vi.stubGlobal("React", React);
const token: FlowToken = {
  ticker: "NVDA",
  symbol: "NVDAB",
  address: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
  issuer: "bstock",
  multiplier: 10n ** 18n,
};
const now = 1800000000000;
function seed(store: ReturnType<typeof openStore>, ageMs: number, source = "binance") {
  const data: FlowSnapshot = {
    token,
    trades: [],
    labels: {},
    holders: null,
    holdersReason: "Holders unavailable",
    coverageStartMs: null,
    notes: source === "chain-logs" ? ["price unavailable from chain logs"] : [],
  };
  store.put({
    kind: "flow-registry",
    key: "bsc",
    source: "engine",
    observedAt: now - ageMs,
    data: [token],
  });
  store.put({ kind: "flow", key: token.address, source, observedAt: now - ageMs, data });
  store.put<RadarGradeSnapshot>({
    kind: "radar",
    key: token.address,
    source: "engine",
    observedAt: now - ageMs,
    data: {
      ticker: "NVDA",
      address: token.address,
      symbol: "NVDAB",
      issuer: "bstock",
      score: 90,
      grade: "A",
      reasons: ["Sources agree"],
      ghost: false,
      integrity: gradeIntegrity({
        session: "closed",
        status: null,
        now,
        unitTrap: false,
        onchainVolume24hUsd: 2000,
      }),
    },
  });
}
it("empty flow view model explains missing observations and never claims a live source", async () => {
  const store = openStore(":memory:");
  try {
    expect(await loadFlow("NVDA", { store, now })).toMatchObject({
      state: "empty",
      stale: false,
      ageMs: null,
      source: null,
      reason: "Flow has no observations yet.",
      error: null,
    });
  } finally {
    store.close();
  }
});
it("snapshot older than 15 minutes shows age and never live in the plain panel", async () => {
  const store = openStore(":memory:");
  try {
    seed(store, 16 * 60000);
    const vm = await loadFlow("NVDA", { store, now });
    expect(vm).toMatchObject({ stale: true, ageMs: 960000 });
    const html = renderToStaticMarkup(React.createElement(FlowContent, { panel: displayFlow(vm) }));
    expect(html).toContain("Stale 16 min ago");
    expect(html).not.toContain("live");
  } finally {
    store.close();
  }
});
it("chain fallback is marked from chain logs and explains that prices are unavailable", async () => {
  const store = openStore(":memory:");
  try {
    seed(store, 1000, "chain-logs");
    const vm = await loadFlow("NVDA", { store, now });
    expect(vm.sourceLabel).toBe("from chain logs");
    const html = renderToStaticMarkup(React.createElement(FlowContent, { panel: displayFlow(vm) }));
    expect(html).toContain("from chain logs");
    expect(html).toContain("price unavailable from chain logs");
  } finally {
    store.close();
  }
});
it("flag off leaves RadarVM without a flow panel and the plain component still shows the grade", async () => {
  const store = openStore(":memory:");
  try {
    seed(store, 1000);
    const vm = await loadRadar({ store, now, flowEnabled: false });
    expect(vm.cards[0]!.flowPanel).toBeNull();
    const html = renderToStaticMarkup(React.createElement(RadarContent, { vm }));
    expect(html).toContain("NVDAB: Grade A");
    expect(html).toContain("Sources agree");
    expect(html).not.toContain('aria-label="Flow');
    const enabled = await loadRadar({ store, now, flowEnabled: true });
    expect(enabled.cards[0]!.flowPanel?.state).toBe("ready");
    expect(
      (await loadRadar({ store, now, filters: { issuer: "ondo" }, flowEnabled: false })).cards,
    ).toHaveLength(0);
    expect(
      (await loadRadar({ store, now, filters: { grade: "F" }, flowEnabled: false })).cards,
    ).toHaveLength(0);
    expect(
      (await loadRadar({ store, now, filters: { ghost: true }, flowEnabled: false })).cards,
    ).toHaveLength(0);
  } finally {
    store.close();
  }
});
it("snapshot-store failure returns an error state with a reason", async () => {
  const store = openStore(":memory:");
  store.close();
  expect(await loadFlow("NVDA", { store, now })).toMatchObject({
    state: "error",
    error: "Snapshot store unavailable",
  });
  expect(await loadRadar({ store, now })).toMatchObject({
    state: "error",
    error: "Snapshot store unavailable",
  });
});

it("a missing multiplier cannot hide a token's Radar grade", async () => {
  const store = openStore(":memory:");
  try {
    const missing = {
      ...token,
      symbol: "NVDAx",
      issuer: "xstocks" as const,
      address: "0xc845b2894dbddd03858fd2d643b4ef725fe0849d",
      multiplier: 0n,
    };
    store.put({
      kind: "radar-registry",
      key: "bsc",
      source: "engine",
      observedAt: now,
      data: [missing],
    });
    store.put<RadarGradeSnapshot>({
      kind: "radar",
      key: missing.address,
      source: "engine",
      observedAt: now,
      data: {
        ...missing,
        score: 35,
        grade: "F",
        reasons: ["Share multiplier unavailable"],
        ghost: true,
        integrity: gradeIntegrity({
          session: "closed",
          status: null,
          now,
          unitTrap: false,
          onchainVolume24hUsd: 0,
        }),
      },
    });
    const vm = await loadRadar({ store, now, flowEnabled: true });
    expect(vm.cards[0]!.grades[0]!.symbol).toBe("NVDAx");
    expect(vm.cards[0]!.grades[0]!.grade).toBe("F");
    expect(vm.cards[0]!.flowPanel).toMatchObject({
      state: "empty",
      reason: expect.stringContaining("NVDAx: no flow observation"),
    });
  } finally {
    store.close();
  }
});

it("Radar uses extendIntegrity exactly for ghost, non-ghost and clamped-at-zero bases", async () => {
  const bases = [
    gradeIntegrity({
      session: "closed",
      status: null,
      now,
      unitTrap: false,
      onchainVolume24hUsd: 0,
    }),
    gradeIntegrity({
      session: "closed",
      status: null,
      now,
      unitTrap: false,
      onchainVolume24hUsd: 2000,
    }),
    gradeIntegrity({
      session: "regular",
      premium: 0.05,
      status: { kind: "paused", reasonCode: "pause", reasonMsg: null, session: "regular" },
      now,
      unitTrap: false,
      onchainVolume24hUsd: 0,
    }),
  ];
  expect(bases[2]!.score).toBe(0);
  for (const base of bases)
    for (const usd of [0n, 2000n * E18]) {
      const store = openStore(":memory:");
      try {
        seed(store, 0);
        const snapshot = store.latest<FlowSnapshot>("flow", token.address, {
          maxAgeMs: 900000,
          now,
        })!.data;
        snapshot.coverageStartMs = now - WINDOWS["7d"];
        snapshot.trades = [
          {
            id: "test",
            txHash: "test",
            wallet: "wallet",
            side: "buy",
            at: now,
            shares: E18,
            usd,
            pricePerShare: usd,
            priceReason: null,
            source: "binance",
          },
        ];
        store.put({
          kind: "flow",
          key: token.address,
          source: "binance",
          observedAt: now,
          data: snapshot,
        });
        const row = store.latest<RadarGradeSnapshot>("radar", token.address, {
          maxAgeMs: 900000,
          now,
        })!.data;
        store.put({
          kind: "radar",
          key: token.address,
          source: "engine",
          observedAt: now,
          data: {
            ...row,
            integrity: base,
            score: base.score,
            grade: base.grade,
            reasons: base.reasons.map((r) => r.reason ?? r.summary),
            ghost: base.flags.includes("ghost"),
          },
        });
        const expected = extendIntegrity(base, ghostInput(aggregateFlow(snapshot, now)));
        const grade = (await loadRadar({ store, now, flowEnabled: true })).cards[0]!.grades[0]!;
        expect(grade.integrity).toEqual(expected);
        expect(grade.score).toBe(expected.score);
        expect(grade.grade).toBe(expected.grade);
        expect(grade.ghost).toBe(expected.flags.includes("ghost"));
        expect(grade.reasons).toEqual(expected.reasons.map((r) => r.reason ?? r.summary));
        expect(grade.gradeBasis).toBe("cleaned flow");
      } finally {
        store.close();
      }
    }
});

it("inactive raw ghosts keep an aged Radar grade and an exclusion reason without a flow panel", async () => {
  const store = openStore(":memory:");
  try {
    seed(store, 20 * 60000);
    const row = store.latest<RadarGradeSnapshot>("radar", token.address, {
      maxAgeMs: 3600000,
      now,
    })!;
    store.put({
      kind: "radar",
      key: token.address,
      observedAt: row.observedAt,
      source: row.source,
      data: {
        ...row.data,
        flowActive: false,
        flowReason: "no real market: under $1,000 24h",
        rawVolume24hUsd: 999n * E18,
      },
    });
    const vm = await loadRadar({ store, now, flowEnabled: true });
    expect(vm.cards[0]!.flowPanel).toBeNull();
    expect(vm.cards[0]!.grades[0]).toMatchObject({
      grade: "A",
      ageMs: 20 * 60000,
      stale: false,
      gradeBasis: "engine",
    });
    const html = renderToStaticMarkup(React.createElement(RadarContent, { vm }));
    expect(html).toContain("no real market: under $1,000 24h");
    expect(html).toContain("Grade observed 20 min ago");
    expect(
      (await loadRadar({ store, now: now + 41 * 60000, flowEnabled: true })).cards[0]!.grades[0]!
        .stale,
    ).toBe(true);
  } finally {
    store.close();
  }
});
