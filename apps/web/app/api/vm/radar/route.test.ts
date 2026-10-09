import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { openStore, type OpenSnapshotStore } from "@tally/modkit";
import { gradeIntegrity, E18 } from "@tally/core";
import { aggregateFlow, checkGhost, ghostInput, type FlowSnapshot } from "@tally/mod-flow";

const state = vi.hoisted(() => ({ store: undefined as unknown, flag: true }));
vi.mock("../_lib", () => ({
  vmRoute: async (
    _req: NextRequest,
    _module: string,
    load: (ctx: { store: OpenSnapshotStore }) => Promise<unknown>,
  ) =>
    state.flag
      ? Response.json({ vm: await load({ store: state.store as OpenSnapshotStore }) })
      : new Response(null, { status: 404 }),
}));
import { GET } from "./route";
afterEach(() => {
  vi.restoreAllMocks();
  state.flag = true;
});

it("Radar requests use cached aggregates, log counts only once each, and make no flow reads", async () => {
  const store = openStore(":memory:");
  state.store = store;
  const now = Date.now(),
    token = {
      ticker: "NVDA",
      symbol: "NVDAB",
      issuer: "bstock" as const,
      address: "0x" + "1".repeat(40),
      multiplier: E18,
    };
  const tape: FlowSnapshot = {
    token,
    trades: [],
    labels: {},
    holders: null,
    holdersReason: "unavailable",
    coverageStartMs: null,
    notes: [],
  };
  const aggregate = aggregateFlow(tape, now);
  const integrity = gradeIntegrity({
    session: "closed",
    status: null,
    now,
    unitTrap: false,
    onchainVolume24hUsd: 2000,
  });
  try {
    store.put({
      kind: "radar-registry",
      key: "bsc",
      observedAt: now,
      source: "fixture",
      data: [token],
    });
    for (const [kind, data] of [
      ["flow", tape],
      ["flow-aggregate", aggregate],
      ["flow-ghost", checkGhost(ghostInput(aggregate))],
      [
        "radar",
        {
          ...token,
          score: integrity.score,
          grade: integrity.grade,
          reasons: [],
          ghost: false,
          integrity,
        },
      ],
    ] as const)
      store.put({ kind, key: token.address, observedAt: now, source: "fixture", data });
    const reads = vi.spyOn(store, "latest"),
      log = vi.spyOn(console, "info").mockImplementation(() => {});
    const request = () =>
      new NextRequest("http://localhost/api/vm/radar?issuer=bstock&grade=A&ghost=0");
    const [first, hit] = await Promise.all([GET(request()), GET(request())]);
    expect(first.status).toBe(200);
    expect(hit.status).toBe(200);
    expect(reads.mock.calls.some(([kind]) => kind === "flow")).toBe(false);
    expect(reads.mock.calls.filter(([kind]) => kind === "flow-aggregate")).toHaveLength(1);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]![0]).toMatch(
      /^radar request: ms=\d+\.\d{2} tokens=1 bytesDecoded=\d+$/,
    );
    expect(log.mock.calls[1]![0]).toMatch(/tokens=0 bytesDecoded=0$/);
    expect(log.mock.calls.flat().join()).not.toContain(token.address);
    state.flag = false;
    expect((await GET(request())).status).toBe(404);
    expect(log).toHaveBeenCalledTimes(3);
  } finally {
    store.close();
  }
});
