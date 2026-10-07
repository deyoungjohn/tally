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

it("the panel shows unknown concentration when a holders row has a null percentage", async () => {
  const store = openStore(":memory:");
  try {
    seed(store, 0);
    const snapshot = store.latest<FlowSnapshot>("flow", token.address, {
      maxAgeMs: 900000,
      now,
    })!.data;
    snapshot.holders = [
      {
        holderWalletAddress: "0x" + "1".repeat(40),
        holdAmount: "1",
        holdingPercent: null,
        boughtAmount: "0",
        soldAmount: "0",
      },
    ];
    snapshot.holdersReason = null;
    store.put({
      kind: "flow",
      key: token.address,
      source: "binance",
      observedAt: now,
      data: snapshot,
    });
    const vm = await loadFlow("NVDA", { store, now });
    expect(vm.issuers[0]!.top10ConcentrationPercent).toBeNull();
    const html = renderToStaticMarkup(React.createElement(FlowContent, { panel: displayFlow(vm) }));
    expect(html).toContain("Holder supply percentage unavailable; concentration unknown");
    expect(html).not.toContain("Top ten holders excluding custody: 0%");
  } finally {
    store.close();
  }
});

it("Radar grades carry executable and executableReason only from facts the snapshot has", async () => {
  const store = openStore(":memory:");
  try {
    seed(store, 1000);
    const healthy = (await loadRadar({ store, now, flowEnabled: true })).cards[0]!.grades[0]!;
    // Nothing blocks it, but the snapshot cannot say the route is open: null with the reason, never true.
    expect(healthy.executable).toBeNull();
    expect(healthy.executableReason).toContain("does not record");
    const ghost = {
      ...token,
      symbol: "NVDAx",
      issuer: "xstocks" as const,
      address: "0xc845b2894dbddd03858fd2d643b4ef725fe0849d",
    };
    const unknown = {
      ...ghost,
      symbol: "NVDAon",
      issuer: "ondo" as const,
      address: "0x0000000000000000000000000000000000000abc",
      multiplier: 0n,
    };
    store.put({
      kind: "radar-registry",
      key: "bsc",
      source: "engine",
      observedAt: now,
      data: [token, ghost, unknown],
    });
    for (const [t, volume] of [
      [ghost, 0],
      [unknown, 5000],
    ] as const)
      store.put<RadarGradeSnapshot>({
        kind: "radar",
        key: t.address,
        source: "engine",
        observedAt: now,
        data: {
          ...t,
          ticker: "NVDA",
          score: 50,
          grade: "C",
          reasons: [],
          ghost: volume === 0,
          integrity: gradeIntegrity({
            session: "closed",
            status: null,
            now,
            unitTrap: false,
            onchainVolume24hUsd: volume,
          }),
        },
      });
    const grades = (await loadRadar({ store, now, flowEnabled: false })).cards.flatMap(
      (c) => c.grades,
    );
    expect(grades.find((g) => g.symbol === "NVDAx")).toMatchObject({
      executable: false,
      executableReason: "Almost no trading: a ghost market",
    });
    expect(grades.find((g) => g.symbol === "NVDAon")).toMatchObject({
      executable: false,
      executableReason: "The share count of this token is unknown",
    });
  } finally {
    store.close();
  }
});

it("cleanedFlowUsd24h is the flow aggregate's own 24h volume as an E18 string, and null when flow has none", async () => {
  const store = openStore(":memory:");
  try {
    seed(store, 1000);
    // Flow is present but has no coverage: the aggregate itself says the volume is unknown.
    const none = (await loadRadar({ store, now, flowEnabled: true })).cards[0]!.grades[0]!;
    expect(none.cleanedFlowUsd24h).toBeNull();
    const trade = {
      id: "t1",
      txHash: `0x${"ab".repeat(32)}`,
      wallet: "0x00000000000000000000000000000000000000a1",
      side: "buy" as const,
      at: now - 60_000,
      shares: 3n * E18,
      usd: 700n * E18,
      pricePerShare: 233n * E18,
      priceReason: null,
      source: "binance" as const,
    };
    const covered: FlowSnapshot = {
      token,
      trades: [trade, { ...trade, id: "t2", usd: 50n * E18, shares: E18 }],
      labels: {},
      holders: null,
      holdersReason: "Holders unavailable",
      coverageStartMs: now - 7 * 86_400_000,
      notes: [],
    };
    store.put({
      kind: "flow",
      key: token.address,
      source: "binance",
      observedAt: now - 1000,
      data: covered,
    });
    const grade = (await loadRadar({ store, now, flowEnabled: true })).cards[0]!.grades[0]!;
    expect(grade.cleanedFlowUsd24h).toBe((750n * E18).toString());
    expect(grade.gradeBasis).toBe("cleaned flow");
    // With flow off, the grade is not cleaned-flow and carries no cleaned volume.
    const off = (await loadRadar({ store, now, flowEnabled: false })).cards[0]!.grades[0]!;
    expect(off.cleanedFlowUsd24h).toBeNull();
  } finally {
    store.close();
  }
});
