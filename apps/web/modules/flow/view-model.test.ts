import { expect, it, vi } from "vitest";
import { openStore } from "@tally/modkit";
import { type FlowSnapshot, type FlowToken } from "@tally/mod-flow";
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
